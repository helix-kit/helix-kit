#include "helix_events_service.h"

#include "sdkconfig.h"

#if CONFIG_HELIX_EVENT_QUEUE

#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"

#include "events_contract.h"
#include "helix_event_queue.h"
#include "service_dispatcher.h"

static const char *TAG = "helix_events_service";

#define LIST_MAX 16

static const char *status_str(int64_t status)
{
    switch (status) {
        case HELIX_EVENT_SENT: return "sent";
        case HELIX_EVENT_EXPIRED: return "expired";
        default: return "pending";
    }
}

static int status_filter_from(const cJSON *payload)
{
    const cJSON *s = cJSON_GetObjectItemCaseSensitive(payload, "status");
    if (!cJSON_IsString(s)) return -1;
    if (!strcmp(s->valuestring, "pending")) return HELIX_EVENT_PENDING;
    if (!strcmp(s->valuestring, "sent")) return HELIX_EVENT_SENT;
    if (!strcmp(s->valuestring, "expired")) return HELIX_EVENT_EXPIRED;
    return -1;
}

// Wall-clock timestamps for display. Internal timing is monotonic, so derive
// expiry/sent wall times from the enqueue wall time + the monotonic delta (0
// when the enqueue clock was unset, e.g. pre-SNTP / QEMU).
static double wall_from_mono(const helix_event_record_t *r, int64_t mono_ms)
{
    if (r->created_ts <= 0 || mono_ms <= 0) return 0;
    return (double)(r->created_ts + (mono_ms - r->created_ms) / 1000);
}

static void fill_summary(cJSON *o, const helix_event_record_t *r)
{
    cJSON_AddNumberToObject(o, "id", (double)r->id);
    cJSON_AddStringToObject(o, "msgId", r->msg_id);
    cJSON_AddStringToObject(o, "service", r->service);
    cJSON_AddStringToObject(o, "eventType", r->event_type);
    cJSON_AddStringToObject(o, "status", status_str(r->status));
    cJSON_AddNumberToObject(o, "attempts", (double)r->attempts);
    cJSON_AddNumberToObject(o, "createdTs", (double)r->created_ts);
    cJSON_AddNumberToObject(o, "expiryTs", wall_from_mono(r, r->expiry_ms));
    cJSON_AddNumberToObject(o, "sentTs", wall_from_mono(r, r->sent_ms));
}

static esp_err_t handle_stats(const helix_service_invocation_t *inv)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "pending", helix_event_queue_count(HELIX_EVENT_PENDING));
    cJSON_AddNumberToObject(o, "sent", helix_event_queue_count(HELIX_EVENT_SENT));
    cJSON_AddNumberToObject(o, "expired", helix_event_queue_count(HELIX_EVENT_EXPIRED));
    cJSON_AddNumberToObject(o, "total", helix_event_queue_count(-1));
    return service_dispatcher_respond(inv, "events-stats", o);
}

static esp_err_t handle_list(const helix_service_invocation_t *inv, const cJSON *payload)
{
    int status = status_filter_from(payload);
    const cJSON *limit = cJSON_GetObjectItemCaseSensitive(payload, "limit");
    const cJSON *offset = cJSON_GetObjectItemCaseSensitive(payload, "offset");
    size_t lim = cJSON_IsNumber(limit) && limit->valuedouble > 0 ? (size_t)limit->valuedouble : LIST_MAX;
    if (lim > LIST_MAX) lim = LIST_MAX;
    size_t off = cJSON_IsNumber(offset) && offset->valuedouble > 0 ? (size_t)offset->valuedouble : 0;

    // Records are ~768 B; keep the batch on the heap, not the transport-task stack.
    helix_event_record_t *rows = malloc(sizeof(helix_event_record_t) * LIST_MAX);
    if (rows == NULL) return service_dispatcher_fail(inv, "out of memory");
    int n = helix_event_queue_list(status, lim, off, rows, LIST_MAX);
    if (n < 0) {
        free(rows);
        return service_dispatcher_fail(inv, "list failed");
    }

    cJSON *arr = cJSON_CreateArray();
    for (int i = 0; i < n; i++) {
        cJSON *o = cJSON_CreateObject();
        fill_summary(o, &rows[i]);
        cJSON_AddItemToArray(arr, o);
    }
    free(rows);
    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "count", n);
    cJSON_AddItemToObject(reply, "events", arr);
    return service_dispatcher_respond(inv, "events-list", reply);
}

static esp_err_t handle_get(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(payload, "id");
    if (!cJSON_IsNumber(id)) return service_dispatcher_fail(inv, "get requires id");
    helix_event_record_t r;
    if (helix_event_queue_get((int64_t)id->valuedouble, &r) != ESP_OK) {
        return service_dispatcher_fail(inv, "not found");
    }
    cJSON *o = cJSON_CreateObject();
    fill_summary(o, &r);
    cJSON_AddStringToObject(o, "envelope", r.envelope);
    return service_dispatcher_respond(inv, "events-detail", o);
}

static esp_err_t handle_emit(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *service = cJSON_GetObjectItemCaseSensitive(payload, "service");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(payload, "eventType");
    if (!cJSON_IsString(service) || !cJSON_IsString(type)) {
        return service_dispatcher_fail(inv, "emit requires service and eventType");
    }
    const cJSON *ttl = cJSON_GetObjectItemCaseSensitive(payload, "ttlSec");
    uint32_t ttl_sec = cJSON_IsNumber(ttl) && ttl->valuedouble > 0 ? (uint32_t)ttl->valuedouble : 0;

    const cJSON *body = cJSON_GetObjectItemCaseSensitive(payload, "payload");
    cJSON *body_copy = body != NULL ? cJSON_Duplicate(body, true) : NULL;

    int64_t id = 0;
    char msg_id[96] = {0};
    esp_err_t err = helix_event_queue_enqueue(service->valuestring, type->valuestring, body_copy,
                                              ttl_sec, &id, msg_id, sizeof(msg_id));
    if (err != ESP_OK) return service_dispatcher_fail(inv, "emit failed");

    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", (double)id);
    cJSON_AddStringToObject(o, "msgId", msg_id);
    return service_dispatcher_respond(inv, "events-emit", o);
}

static esp_err_t handle_sweep(const helix_service_invocation_t *inv)
{
    helix_event_sweep_stats_t s = {0};
    helix_event_queue_sweep(&s);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "retried", s.retried);
    cJSON_AddNumberToObject(o, "expired", s.expired);
    cJSON_AddNumberToObject(o, "cleaned", s.cleaned);
    cJSON_AddNumberToObject(o, "pending", s.pending);
    return service_dispatcher_respond(inv, "events-sweep", o);
}

#if CONFIG_HELIX_EVENTS_TEST_HOOKS
static esp_err_t handle_simulate(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(payload, "id");
    if (!cJSON_IsNumber(id)) return service_dispatcher_fail(inv, "simulate-delivery requires id");
    helix_event_queue_simulate_delivery((int64_t)id->valuedouble);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "ok", true);
    return service_dispatcher_respond(inv, "events-ok", o);
}

static esp_err_t handle_clear(const helix_service_invocation_t *inv)
{
    int n = helix_event_queue_clear();
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "cleared", n);
    return service_dispatcher_respond(inv, "events-ok", o);
}
#endif

static esp_err_t events_handle_command(const helix_service_invocation_t *inv,
                                       const char *method, const cJSON *payload)
{
    if (!strcmp(method, EVENTS_STATS_METHOD)) return handle_stats(inv);
    if (!strcmp(method, EVENTS_LIST_METHOD)) return handle_list(inv, payload);
    if (!strcmp(method, EVENTS_GET_METHOD)) return handle_get(inv, payload);
    if (!strcmp(method, EVENTS_EMIT_METHOD)) return handle_emit(inv, payload);
    if (!strcmp(method, EVENTS_SWEEP_METHOD)) return handle_sweep(inv);
#if CONFIG_HELIX_EVENTS_TEST_HOOKS
    if (!strcmp(method, "simulate-delivery")) return handle_simulate(inv, payload);
    if (!strcmp(method, "clear")) return handle_clear(inv);
#endif
    return service_dispatcher_fail(inv, "unknown events method");
}

esp_err_t helix_events_service_start(void)
{
    if (!helix_event_queue_ready()) {
        ESP_LOGW(TAG, "event queue not ready; events service not registered");
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = service_dispatcher_register(EVENTS_SERVICE, events_handle_command);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "events service started");
    }
    return err;
}

#else /* !CONFIG_HELIX_EVENT_QUEUE */

esp_err_t helix_events_service_start(void) { return ESP_OK; }

#endif /* CONFIG_HELIX_EVENT_QUEUE */
