#include "helix_db.h"

#include "sdkconfig.h"

#if CONFIG_HELIX_DB

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <fal.h>
#include <flashdb.h>

static const char *TAG = "helix_db";

#define KEY_MAX 64

static struct fdb_kvdb s_kvdb;
static SemaphoreHandle_t s_kvdb_lock;   // FlashDB internal lock
static SemaphoreHandle_t s_api_lock;    // serialises helix_db API (guards sort ctx)
static bool s_ready;

static void kvdb_lock(fdb_db_t db) { (void)db; xSemaphoreTake(s_kvdb_lock, portMAX_DELAY); }
static void kvdb_unlock(fdb_db_t db) { (void)db; xSemaphoreGive(s_kvdb_lock); }

esp_err_t helix_db_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }
    if (s_kvdb_lock == NULL) {
        s_kvdb_lock = xSemaphoreCreateMutex();
        s_api_lock = xSemaphoreCreateMutex();
        if (s_kvdb_lock == NULL || s_api_lock == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    if (fal_init() < 0) {
        ESP_LOGE(TAG, "fal_init failed");
        return ESP_FAIL;
    }
    fdb_kvdb_control(&s_kvdb, FDB_KVDB_CTRL_SET_LOCK, (void *)kvdb_lock);
    fdb_kvdb_control(&s_kvdb, FDB_KVDB_CTRL_SET_UNLOCK, (void *)kvdb_unlock);

    fdb_err_t err = fdb_kvdb_init(&s_kvdb, "helix", "fdb_kvdb1", NULL, NULL);
    if (err != FDB_NO_ERR) {
        ESP_LOGE(TAG, "kvdb init failed: %d", err);
        return ESP_FAIL;
    }
    s_ready = true;
    ESP_LOGI(TAG, "FlashDB KVDB ready (partition fdb_kvdb1)");
    return ESP_OK;
}

bool helix_db_ready(void) { return s_ready; }

static const hdb_column_t *find_col(const hdb_table_t *t, const char *name)
{
    for (size_t i = 0; i < t->column_count; i++) {
        if (strcmp(t->columns[i].name, name) == 0) {
            return &t->columns[i];
        }
    }
    return NULL;
}

static void row_key(const hdb_table_t *t, uint32_t id, char *out)
{
    snprintf(out, KEY_MAX, "%s#%u", t->name, (unsigned)id);
}

static void seq_key(const hdb_table_t *t, char *out)
{
    snprintf(out, KEY_MAX, "%s:seq", t->name);
}

// Does key `name` belong to table `t`'s rows ("<table>#...")? If so return the id.
static bool key_row_id(const hdb_table_t *t, const char *name, uint32_t *out_id)
{
    size_t nlen = strlen(t->name);
    if (strncmp(name, t->name, nlen) != 0 || name[nlen] != '#') {
        return false;
    }
    *out_id = (uint32_t)strtoul(name + nlen + 1, NULL, 10);
    return true;
}

static void stamp_id(const hdb_table_t *t, void *row, uint32_t id)
{
    const hdb_column_t *idc = find_col(t, "id");
    if (idc != NULL && idc->type == HDB_I64) {
        int64_t v = id;
        memcpy((uint8_t *)row + idc->offset, &v, sizeof(v));
    }
}

// Read a numeric column as double for comparison; TEXT handled separately.
static double col_num(const hdb_column_t *c, const void *row)
{
    const uint8_t *p = (const uint8_t *)row + c->offset;
    if (c->type == HDB_I64) {
        int64_t v; memcpy(&v, p, sizeof(v)); return (double)v;
    }
    double v; memcpy(&v, p, sizeof(v)); return v;
}

static bool cmp_op(hdb_op_t op, int order)
{
    switch (op) {
        case HDB_EQ: return order == 0;
        case HDB_NE: return order != 0;
        case HDB_LT: return order < 0;
        case HDB_LE: return order <= 0;
        case HDB_GT: return order > 0;
        case HDB_GE: return order >= 0;
        default: return false;
    }
}

static bool row_matches(const hdb_table_t *t, const hdb_query_t *q, const void *row)
{
    if (q == NULL || q->conds == NULL) {
        return true;
    }
    for (size_t i = 0; i < q->cond_count; i++) {
        const hdb_cond_t *c = &q->conds[i];
        const hdb_column_t *col = find_col(t, c->column);
        if (col == NULL) {
            return false;
        }
        if (col->type == HDB_TEXT) {
            const char *field = (const char *)row + col->offset;
            if (c->op == HDB_LIKE) {
                if (c->s == NULL || strstr(field, c->s) == NULL) return false;
            } else {
                int order = strncmp(field, c->s ? c->s : "", col->size);
                if (!cmp_op(c->op, order)) return false;
            }
        } else {
            if (c->op == HDB_LIKE) return false;  // LIKE only for text
            double a = col_num(col, row);
            double b = (col->type == HDB_I64) ? (double)c->i : c->f;
            int order = (a < b) ? -1 : (a > b) ? 1 : 0;
            if (!cmp_op(c->op, order)) return false;
        }
    }
    return true;
}

// qsort context (guarded by s_api_lock).
static const hdb_table_t *s_sort_table;
static const hdb_column_t *s_sort_col;
static bool s_sort_desc;

static int row_cmp(const void *a, const void *b)
{
    int order;
    if (s_sort_col->type == HDB_TEXT) {
        order = strncmp((const char *)a + s_sort_col->offset,
                        (const char *)b + s_sort_col->offset, s_sort_col->size);
    } else {
        double x = col_num(s_sort_col, a), y = col_num(s_sort_col, b);
        order = (x < y) ? -1 : (x > y) ? 1 : 0;
    }
    return s_sort_desc ? -order : order;
}

esp_err_t hdb_insert(const hdb_table_t *t, const void *row, uint32_t *out_id)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    esp_err_t ret = ESP_OK;

    char sk[KEY_MAX]; seq_key(t, sk);
    uint32_t seq = 0;
    struct fdb_blob blob;
    if (fdb_kv_get_blob(&s_kvdb, sk, fdb_blob_make(&blob, &seq, sizeof(seq))) != sizeof(seq)) {
        seq = 1;  // ids start at 1
    }
    uint32_t id = seq;
    uint32_t next = id + 1;
    fdb_kv_set_blob(&s_kvdb, sk, fdb_blob_make(&blob, &next, sizeof(next)));

    uint8_t *tmp = malloc(t->row_size);
    if (tmp == NULL) { ret = ESP_ERR_NO_MEM; goto done; }
    memcpy(tmp, row, t->row_size);
    stamp_id(t, tmp, id);

    char rk[KEY_MAX]; row_key(t, id, rk);
    fdb_err_t e = fdb_kv_set_blob(&s_kvdb, rk, fdb_blob_make(&blob, tmp, t->row_size));
    free(tmp);
    if (e != FDB_NO_ERR) { ret = ESP_FAIL; goto done; }
    if (out_id) *out_id = id;

done:
    xSemaphoreGive(s_api_lock);
    return ret;
}

esp_err_t hdb_get(const hdb_table_t *t, uint32_t id, void *row_out)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    char rk[KEY_MAX]; row_key(t, id, rk);
    struct fdb_blob blob;
    size_t n = fdb_kv_get_blob(&s_kvdb, rk, fdb_blob_make(&blob, row_out, t->row_size));
    xSemaphoreGive(s_api_lock);
    return (n == t->row_size) ? ESP_OK : ESP_ERR_NOT_FOUND;
}

esp_err_t hdb_update(const hdb_table_t *t, uint32_t id, const void *row)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    esp_err_t ret;
    char rk[KEY_MAX]; row_key(t, id, rk);
    struct fdb_kv kv;
    if (fdb_kv_get_obj(&s_kvdb, rk, &kv) == NULL) {
        ret = ESP_ERR_NOT_FOUND;
    } else {
        uint8_t *tmp = malloc(t->row_size);
        if (tmp == NULL) { ret = ESP_ERR_NO_MEM; }
        else {
            memcpy(tmp, row, t->row_size);
            stamp_id(t, tmp, id);
            struct fdb_blob blob;
            fdb_err_t e = fdb_kv_set_blob(&s_kvdb, rk, fdb_blob_make(&blob, tmp, t->row_size));
            free(tmp);
            ret = (e == FDB_NO_ERR) ? ESP_OK : ESP_FAIL;
        }
    }
    xSemaphoreGive(s_api_lock);
    return ret;
}

esp_err_t hdb_delete(const hdb_table_t *t, uint32_t id)
{
    if (!s_ready) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    char rk[KEY_MAX]; row_key(t, id, rk);
    fdb_err_t e = fdb_kv_del(&s_kvdb, rk);
    xSemaphoreGive(s_api_lock);
    return (e == FDB_NO_ERR) ? ESP_OK : ESP_ERR_NOT_FOUND;
}

int hdb_select(const hdb_table_t *t, const hdb_query_t *q, void *rows_out, size_t max_rows)
{
    if (!s_ready) return -ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);

    uint8_t *out = rows_out;
    size_t count = 0;
    uint8_t *rowbuf = malloc(t->row_size);
    if (rowbuf == NULL) { xSemaphoreGive(s_api_lock); return -ESP_ERR_NO_MEM; }

    struct fdb_kv_iterator itr;
    fdb_kv_iterator_init(&s_kvdb, &itr);
    while (count < max_rows && fdb_kv_iterate(&s_kvdb, &itr)) {
        uint32_t id;
        if (!key_row_id(t, itr.curr_kv.name, &id)) continue;
        struct fdb_blob blob;
        fdb_kv_to_blob(&itr.curr_kv, fdb_blob_make(&blob, rowbuf, t->row_size));
        if (fdb_blob_read((fdb_db_t)&s_kvdb, &blob) != t->row_size) continue;
        if (!row_matches(t, q, rowbuf)) continue;
        memcpy(out + count * t->row_size, rowbuf, t->row_size);
        count++;
    }
    free(rowbuf);

    // ORDER BY (sort the materialised matches).
    if (q != NULL && q->order_by != NULL && count > 1) {
        const hdb_column_t *col = find_col(t, q->order_by);
        if (col != NULL) {
            s_sort_table = t;
            s_sort_col = col;
            s_sort_desc = q->descending;
            qsort(out, count, t->row_size, row_cmp);
        }
    }

    // OFFSET / LIMIT (applied after ordering).
    if (q != NULL) {
        if (q->offset > 0) {
            if (q->offset >= count) {
                count = 0;
            } else {
                memmove(out, out + q->offset * t->row_size, (count - q->offset) * t->row_size);
                count -= q->offset;
            }
        }
        if (q->limit > 0 && count > q->limit) {
            count = q->limit;
        }
    }

    xSemaphoreGive(s_api_lock);
    return (int)count;
}

int hdb_count(const hdb_table_t *t, const hdb_query_t *q)
{
    if (!s_ready) return -ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    uint8_t *rowbuf = malloc(t->row_size);
    if (rowbuf == NULL) { xSemaphoreGive(s_api_lock); return -ESP_ERR_NO_MEM; }
    int count = 0;
    struct fdb_kv_iterator itr;
    fdb_kv_iterator_init(&s_kvdb, &itr);
    while (fdb_kv_iterate(&s_kvdb, &itr)) {
        uint32_t id;
        if (!key_row_id(t, itr.curr_kv.name, &id)) continue;
        struct fdb_blob blob;
        fdb_kv_to_blob(&itr.curr_kv, fdb_blob_make(&blob, rowbuf, t->row_size));
        if (fdb_blob_read((fdb_db_t)&s_kvdb, &blob) != t->row_size) continue;
        if (row_matches(t, q, rowbuf)) count++;
    }
    free(rowbuf);
    xSemaphoreGive(s_api_lock);
    return count;
}

int hdb_delete_where(const hdb_table_t *t, const hdb_query_t *q)
{
    if (!s_ready) return -ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_api_lock, portMAX_DELAY);
    uint8_t *rowbuf = malloc(t->row_size);
    if (rowbuf == NULL) { xSemaphoreGive(s_api_lock); return -ESP_ERR_NO_MEM; }

    int deleted = 0;
    // Deleting during iteration is unsafe: gather ids in batches and delete between passes until none match.
    enum { BATCH = 64 };
    bool more = true;
    while (more) {
        uint32_t ids[BATCH];
        size_t n = 0;
        struct fdb_kv_iterator itr;
        fdb_kv_iterator_init(&s_kvdb, &itr);
        while (n < BATCH && fdb_kv_iterate(&s_kvdb, &itr)) {
            uint32_t id;
            if (!key_row_id(t, itr.curr_kv.name, &id)) continue;
            struct fdb_blob blob;
            fdb_kv_to_blob(&itr.curr_kv, fdb_blob_make(&blob, rowbuf, t->row_size));
            if (fdb_blob_read((fdb_db_t)&s_kvdb, &blob) != t->row_size) continue;
            if (row_matches(t, q, rowbuf)) ids[n++] = id;
        }
        for (size_t i = 0; i < n; i++) {
            char rk[KEY_MAX]; row_key(t, ids[i], rk);
            if (fdb_kv_del(&s_kvdb, rk) == FDB_NO_ERR) deleted++;
        }
        more = (n == BATCH);
    }
    free(rowbuf);
    xSemaphoreGive(s_api_lock);
    return deleted;
}

#else /* !CONFIG_HELIX_DB */

esp_err_t helix_db_init(void) { return ESP_OK; }
bool helix_db_ready(void) { return false; }

#endif /* CONFIG_HELIX_DB */
