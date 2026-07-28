#include "helix_event_queue.h"

#include "sdkconfig.h"

#if CONFIG_HELIX_EVENT_QUEUE

#include <inttypes.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "helix_db.h"
#include "helix_transport_mqtt.h"
#include "time_sync.h"

static const char *TAG = "helix_event_queue";

#define TTL_SEC        CONFIG_HELIX_EVENT_QUEUE_TTL_SEC
#define SWEEP_SEC      CONFIG_HELIX_EVENT_QUEUE_SWEEP_SEC
#define RETENTION_SEC  CONFIG_HELIX_EVENT_QUEUE_RETENTION_SEC
#define MAX_EVENTS     CONFIG_HELIX_EVENT_QUEUE_MAX
#define BACKOFF_BASE_MS 5000
#define BACKOFF_CAP_MS  300000
#define SWEEP_BATCH     16
#define INFLIGHT_MAX    16
#define DELIVER_RING    32
#define WALL_VALID_MIN  1700000000LL

// events table (helix_db). Column names/offsets must match helix_event_record_t.
static const hdb_column_t EVENT_COLS[] = {
    {"id",        HDB_I64,  offsetof(helix_event_record_t, id),              0},
    {"msgId",     HDB_TEXT, offsetof(helix_event_record_t, msg_id),          sizeof(((helix_event_record_t *)0)->msg_id)},
    {"service",   HDB_TEXT, offsetof(helix_event_record_t, service),         sizeof(((helix_event_record_t *)0)->service)},
    {"eventType", HDB_TEXT, offsetof(helix_event_record_t, event_type),      sizeof(((helix_event_record_t *)0)->event_type)},
    {"envelope",  HDB_TEXT, offsetof(helix_event_record_t, envelope),        sizeof(((helix_event_record_t *)0)->envelope)},
    {"createdMs", HDB_I64,  offsetof(helix_event_record_t, created_ms),      0},
    {"expiryMs",  HDB_I64,  offsetof(helix_event_record_t, expiry_ms),       0},
    {"status",    HDB_I64,  offsetof(helix_event_record_t, status),          0},
    {"attempts",  HDB_I64,  offsetof(helix_event_record_t, attempts),        0},
    {"lastAtt",   HDB_I64,  offsetof(helix_event_record_t, last_attempt_ms), 0},
    {"sentMs",    HDB_I64,  offsetof(helix_event_record_t, sent_ms),         0},
    {"createdTs", HDB_I64,  offsetof(helix_event_record_t, created_ts),      0},
};

static const hdb_table_t EVENTS_TABLE = {
    .name = "events",
    .columns = EVENT_COLS,
    .column_count = sizeof(EVENT_COLS) / sizeof(EVENT_COLS[0]),
    .row_size = sizeof(helix_event_record_t),
};

static bool s_ready;
static uint32_t s_counter;
static SemaphoreHandle_t s_op_lock;     // serialises enqueue + sweep (sole row-status writer)
static SemaphoreHandle_t s_ring_lock;   // guards the delivered ring

// in-flight publishes (owned by the sweep task only)
static struct { bool used; int msg_id; int64_t row_id; } s_inflight[INFLIGHT_MAX];

// deliveries acked by the broker (or simulated), pushed from other tasks, drained by sweep
static struct { bool by_row; int64_t value; } s_ring[DELIVER_RING];
static int s_ring_head, s_ring_tail;

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void ring_push(bool by_row, int64_t value)
{
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    int next = (s_ring_head + 1) % DELIVER_RING;
    if (next != s_ring_tail) {  // drop on overflow (event stays pending, retried)
        s_ring[s_ring_head].by_row = by_row;
        s_ring[s_ring_head].value = value;
        s_ring_head = next;
    }
    xSemaphoreGive(s_ring_lock);
}

static void mqtt_publish_ack(int msg_id, void *ctx)
{
    (void)ctx;
    ring_push(false, msg_id);
}

static void inflight_add(int msg_id, int64_t row_id)
{
    for (int i = 0; i < INFLIGHT_MAX; i++) {
        if (!s_inflight[i].used) {
            s_inflight[i] = (typeof(s_inflight[0])){.used = true, .msg_id = msg_id, .row_id = row_id};
            return;
        }
    }
    // full: overwrite slot 0 (its ack, if any, will be unmatched -> event retried)
    s_inflight[0] = (typeof(s_inflight[0])){.used = true, .msg_id = msg_id, .row_id = row_id};
}

static int64_t inflight_take(int msg_id)
{
    for (int i = 0; i < INFLIGHT_MAX; i++) {
        if (s_inflight[i].used && s_inflight[i].msg_id == msg_id) {
            s_inflight[i].used = false;
            return s_inflight[i].row_id;
        }
    }
    return -1;
}

// Row helpers (call under s_op_lock).
static void mark_sent(int64_t row_id)
{
    helix_event_record_t r;
    if (helix_event_queue_get(row_id, &r) != ESP_OK) return;
    if (r.status != HELIX_EVENT_PENDING) return;
    r.status = HELIX_EVENT_SENT;
    r.sent_ms = now_ms();
    hdb_update(&EVENTS_TABLE, (uint32_t)row_id, &r);
}

// Evict one row to make space, preferring terminal rows (oldest sent -> expired -> pending).
static bool evict_one(void)
{
    static const int order[] = {HELIX_EVENT_SENT, HELIX_EVENT_EXPIRED, HELIX_EVENT_PENDING};
    for (size_t k = 0; k < sizeof(order) / sizeof(order[0]); k++) {
        helix_event_record_t r;
        if (helix_event_queue_list(order[k], 1, 0, &r, 1) == 1) {
            ESP_LOGW(TAG, "queue full: evicting event id=%lld status=%d",
                     (long long)r.id, (int)r.status);
            hdb_delete(&EVENTS_TABLE, (uint32_t)r.id);
            return true;
        }
    }
    return false;
}

static void sweep_task(void *arg);

esp_err_t helix_event_queue_init(void)
{
    if (s_ready) return ESP_OK;
    if (!helix_db_ready()) {
        ESP_LOGW(TAG, "helix_db not ready; event queue disabled");
        return ESP_ERR_INVALID_STATE;
    }
    s_op_lock = xSemaphoreCreateMutex();
    s_ring_lock = xSemaphoreCreateMutex();
    if (s_op_lock == NULL || s_ring_lock == NULL) return ESP_ERR_NO_MEM;

    helix_mqtt_transport_set_publish_callback(mqtt_publish_ack, NULL);
    s_ready = true;

    BaseType_t ok = xTaskCreate(sweep_task, "evt_queue", 6144, NULL, 5, NULL);
    if (ok != pdPASS) { s_ready = false; return ESP_ERR_NO_MEM; }
    ESP_LOGI(TAG, "event queue ready (ttl=%ds sweep=%ds retention=%ds max=%d)",
             TTL_SEC, SWEEP_SEC, RETENTION_SEC, MAX_EVENTS);
    return ESP_OK;
}

bool helix_event_queue_ready(void) { return s_ready; }

esp_err_t helix_event_queue_enqueue(const char *service, const char *type, cJSON *payload,
                                    uint32_t ttl_sec, int64_t *out_id, char *out_msg_id, size_t msg_id_len)
{
    if (service == NULL || service[0] == '\0' || type == NULL || type[0] == '\0') {
        cJSON_Delete(payload);
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_ready) {
        cJSON_Delete(payload);
        return ESP_ERR_INVALID_STATE;
    }

    char timestamp[32];
    time_format_utc(timestamp, sizeof(timestamp));
    int64_t wall = (int64_t)time(NULL);

    char msg_id[96];
    snprintf(msg_id, sizeof(msg_id), "%s-%s-%" PRIu32 "-%08" PRIx32,
             service, timestamp, ++s_counter, esp_random());

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) { cJSON_Delete(payload); return ESP_ERR_NO_MEM; }
    cJSON_AddStringToObject(root, "type", type);
    cJSON_AddStringToObject(root, "msgId", msg_id);
    cJSON_AddStringToObject(root, "timestamp", timestamp);
    cJSON_AddItemToObject(root, "payload", payload != NULL ? payload : cJSON_CreateObject());
    char *env = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);  // frees payload too
    if (env == NULL) return ESP_ERR_NO_MEM;

    helix_event_record_t r = {0};
    if (strlcpy(r.envelope, env, sizeof(r.envelope)) >= sizeof(r.envelope)) {
        free(env);
        ESP_LOGE(TAG, "event envelope too large (> %u bytes); dropped", (unsigned)sizeof(r.envelope));
        return ESP_ERR_INVALID_SIZE;
    }
    free(env);

    strlcpy(r.msg_id, msg_id, sizeof(r.msg_id));
    strlcpy(r.service, service, sizeof(r.service));
    strlcpy(r.event_type, type, sizeof(r.event_type));
    int64_t t = now_ms();
    uint32_t ttl = ttl_sec > 0 ? ttl_sec : (uint32_t)TTL_SEC;
    r.created_ms = t;
    r.expiry_ms = ttl > 0 ? t + (int64_t)ttl * 1000 : 0;
    r.status = HELIX_EVENT_PENDING;
    r.created_ts = wall >= WALL_VALID_MIN ? wall : 0;

    xSemaphoreTake(s_op_lock, portMAX_DELAY);
    while (helix_event_queue_count(-1) >= MAX_EVENTS) {
        if (!evict_one()) break;
    }
    uint32_t id = 0;
    esp_err_t err = hdb_insert(&EVENTS_TABLE, &r, &id);
    xSemaphoreGive(s_op_lock);
    if (err != ESP_OK) return err;

    if (out_id != NULL) *out_id = id;
    if (out_msg_id != NULL) strlcpy(out_msg_id, msg_id, msg_id_len);
    ESP_LOGI(TAG, "enqueued event id=%u service=%s type=%s", (unsigned)id, service, type);
    return ESP_OK;
}

int helix_event_queue_count(int status_filter)
{
    hdb_cond_t c = {.column = "status", .op = HDB_EQ, .i = status_filter};
    hdb_query_t q = {0};
    if (status_filter >= 0) { q.conds = &c; q.cond_count = 1; }
    return hdb_count(&EVENTS_TABLE, &q);
}

int helix_event_queue_list(int status_filter, size_t limit, size_t offset,
                           helix_event_record_t *out, size_t max_rows)
{
    hdb_cond_t c = {.column = "status", .op = HDB_EQ, .i = status_filter};
    hdb_query_t q = {0};
    if (status_filter >= 0) { q.conds = &c; q.cond_count = 1; }
    q.order_by = "id";
    q.limit = limit;
    q.offset = offset;
    return hdb_select(&EVENTS_TABLE, &q, out, max_rows);
}

esp_err_t helix_event_queue_get(int64_t id, helix_event_record_t *out)
{
    return hdb_get(&EVENTS_TABLE, (uint32_t)id, out);
}

static int64_t backoff_ms(int64_t attempts)
{
    int shift = attempts > 6 ? 6 : (int)attempts;
    int64_t b = (int64_t)BACKOFF_BASE_MS << shift;
    return b > BACKOFF_CAP_MS ? BACKOFF_CAP_MS : b;
}

static void drain_deliveries(void)
{
    // Copy ring out under the ring lock, then resolve/mark under s_op_lock.
    struct { bool by_row; int64_t value; } items[DELIVER_RING];
    int n = 0;
    xSemaphoreTake(s_ring_lock, portMAX_DELAY);
    while (s_ring_tail != s_ring_head && n < DELIVER_RING) {
        items[n++] = (typeof(items[0])){s_ring[s_ring_tail].by_row, s_ring[s_ring_tail].value};
        s_ring_tail = (s_ring_tail + 1) % DELIVER_RING;
    }
    xSemaphoreGive(s_ring_lock);

    for (int i = 0; i < n; i++) {
        int64_t row_id = items[i].by_row ? items[i].value : inflight_take((int)items[i].value);
        if (row_id >= 0) mark_sent(row_id);
    }
}

// `rows` is a caller-provided heap scratch buffer of SWEEP_BATCH records (kept off the task stack).
static int cleanup_terminal(int64_t now, int64_t retention_ms, helix_event_record_t *rows)
{
    int cleaned = 0;
    static const int terminal[] = {HELIX_EVENT_SENT, HELIX_EVENT_EXPIRED};
    for (size_t k = 0; k < sizeof(terminal) / sizeof(terminal[0]); k++) {
        int n = helix_event_queue_list(terminal[k], SWEEP_BATCH, 0, rows, SWEEP_BATCH);
        for (int i = 0; i < n; i++) {
            int64_t terminal_ms = rows[i].status == HELIX_EVENT_SENT ? rows[i].sent_ms : rows[i].expiry_ms;
            if (terminal_ms > 0 && now - terminal_ms >= retention_ms) {
                hdb_delete(&EVENTS_TABLE, (uint32_t)rows[i].id);
                cleaned++;
            }
        }
    }
    return cleaned;
}

esp_err_t helix_event_queue_sweep(helix_event_sweep_stats_t *out)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    // Records are ~768 B each; keep the batch on the heap, not the task stack.
    helix_event_record_t *rows = malloc(sizeof(helix_event_record_t) * SWEEP_BATCH);
    if (rows == NULL) return ESP_ERR_NO_MEM;

    xSemaphoreTake(s_op_lock, portMAX_DELAY);

    drain_deliveries();

    int retried = 0, expired = 0;
    const int64_t t = now_ms();
    const bool online = helix_mqtt_transport_is_online();

    int n = helix_event_queue_list(HELIX_EVENT_PENDING, SWEEP_BATCH, 0, rows, SWEEP_BATCH);
    for (int i = 0; i < n; i++) {
        helix_event_record_t *r = &rows[i];
        if (r->expiry_ms > 0 && t >= r->expiry_ms) {
            r->status = HELIX_EVENT_EXPIRED;
            hdb_update(&EVENTS_TABLE, (uint32_t)r->id, r);
            expired++;
            continue;
        }
        if (online && (r->last_attempt_ms == 0 || t - r->last_attempt_ms >= backoff_ms(r->attempts))) {
            int msg_id = -1;
            esp_err_t e = helix_mqtt_transport_publish_event_json(r->service, r->envelope, &msg_id);
            if (e == ESP_OK) {
                inflight_add(msg_id, r->id);
                r->attempts += 1;
                r->last_attempt_ms = t;
                hdb_update(&EVENTS_TABLE, (uint32_t)r->id, r);
                retried++;
            }
        }
    }

    int cleaned = cleanup_terminal(t, (int64_t)RETENTION_SEC * 1000, rows);
    int pending = helix_event_queue_count(HELIX_EVENT_PENDING);

    xSemaphoreGive(s_op_lock);
    free(rows);

    if (out != NULL) {
        out->retried = retried;
        out->expired = expired;
        out->cleaned = cleaned;
        out->pending = pending;
    }
    if (retried || expired || cleaned) {
        ESP_LOGI(TAG, "sweep retried=%d expired=%d cleaned=%d pending=%d",
                 retried, expired, cleaned, pending);
    }
    return ESP_OK;
}

esp_err_t helix_event_queue_simulate_delivery(int64_t id)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    ring_push(true, id);
    return ESP_OK;
}

int helix_event_queue_clear(void)
{
    if (!s_ready) return -1;
    xSemaphoreTake(s_op_lock, portMAX_DELAY);
    hdb_query_t all = {0};
    int n = hdb_delete_where(&EVENTS_TABLE, &all);
    xSemaphoreGive(s_op_lock);
    return n;
}

static void sweep_task(void *arg)
{
    (void)arg;
    const TickType_t delay = pdMS_TO_TICKS((SWEEP_SEC > 0 ? SWEEP_SEC : 5) * 1000);
    while (true) {
        vTaskDelay(delay);
        helix_event_queue_sweep(NULL);
    }
}

#else /* !CONFIG_HELIX_EVENT_QUEUE */

esp_err_t helix_event_queue_init(void) { return ESP_OK; }
bool helix_event_queue_ready(void) { return false; }
int helix_event_queue_clear(void) { return -1; }

#endif /* CONFIG_HELIX_EVENT_QUEUE */
