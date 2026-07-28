#include "helix_db_service.h"

#include "sdkconfig.h"

#if CONFIG_HELIX_DB

#include <stddef.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"

#include "helix_db.h"
#include "service_dispatcher.h"

static const char *TAG = "helix_db_service";

#define DB_SERVICE "db"
#define MAX_CONDS 4
#define MAX_SELECT_ROWS 32
#define NAME_CAP 32

typedef struct {
    int64_t id;
    char name[NAME_CAP];
    int64_t age;
    double score;
} user_row_t;

static const hdb_column_t USER_COLS[] = {
    {"id",    HDB_I64,  offsetof(user_row_t, id),    0},
    {"name",  HDB_TEXT, offsetof(user_row_t, name),  NAME_CAP},
    {"age",   HDB_I64,  offsetof(user_row_t, age),   0},
    {"score", HDB_F64,  offsetof(user_row_t, score), 0},
};

static const hdb_table_t USERS = {
    .name = "users",
    .columns = USER_COLS,
    .column_count = sizeof(USER_COLS) / sizeof(USER_COLS[0]),
    .row_size = sizeof(user_row_t),
};

static cJSON *row_to_json(const user_row_t *r)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", (double)r->id);
    cJSON_AddStringToObject(o, "name", r->name);
    cJSON_AddNumberToObject(o, "age", (double)r->age);
    cJSON_AddNumberToObject(o, "score", r->score);
    return o;
}

// Overlay fields present in `payload` onto `r` (used by insert/update).
static void apply_fields(user_row_t *r, const cJSON *payload)
{
    const cJSON *name = cJSON_GetObjectItemCaseSensitive(payload, "name");
    if (cJSON_IsString(name)) {
        strlcpy(r->name, name->valuestring, sizeof(r->name));
    }
    const cJSON *age = cJSON_GetObjectItemCaseSensitive(payload, "age");
    if (cJSON_IsNumber(age)) {
        r->age = (int64_t)age->valuedouble;
    }
    const cJSON *score = cJSON_GetObjectItemCaseSensitive(payload, "score");
    if (cJSON_IsNumber(score)) {
        r->score = score->valuedouble;
    }
}

static bool parse_op(const char *s, hdb_op_t *out)
{
    if (!strcmp(s, "eq")) { *out = HDB_EQ; return true; }
    if (!strcmp(s, "ne")) { *out = HDB_NE; return true; }
    if (!strcmp(s, "lt")) { *out = HDB_LT; return true; }
    if (!strcmp(s, "le")) { *out = HDB_LE; return true; }
    if (!strcmp(s, "gt")) { *out = HDB_GT; return true; }
    if (!strcmp(s, "ge")) { *out = HDB_GE; return true; }
    if (!strcmp(s, "like")) { *out = HDB_LIKE; return true; }
    return false;
}

static const hdb_column_t *find_col(const char *name)
{
    for (size_t i = 0; i < USERS.column_count; i++) {
        if (!strcmp(USERS.columns[i].name, name)) return &USERS.columns[i];
    }
    return NULL;
}

// Parse {where:[{col,op,val}], orderBy, desc, limit, offset} into a query; `conds` needs MAX_CONDS entries.
static bool parse_query(const cJSON *payload, hdb_query_t *q, hdb_cond_t *conds)
{
    memset(q, 0, sizeof(*q));
    q->conds = conds;

    const cJSON *where = cJSON_GetObjectItemCaseSensitive(payload, "where");
    if (cJSON_IsArray(where)) {
        const cJSON *item;
        cJSON_ArrayForEach(item, where) {
            if (q->cond_count >= MAX_CONDS) return false;
            const cJSON *col = cJSON_GetObjectItemCaseSensitive(item, "col");
            const cJSON *op = cJSON_GetObjectItemCaseSensitive(item, "op");
            const cJSON *val = cJSON_GetObjectItemCaseSensitive(item, "val");
            if (!cJSON_IsString(col) || !cJSON_IsString(op)) return false;
            const hdb_column_t *c = find_col(col->valuestring);
            if (c == NULL) return false;
            hdb_cond_t *cond = &conds[q->cond_count];
            memset(cond, 0, sizeof(*cond));
            cond->column = c->name;
            if (!parse_op(op->valuestring, &cond->op)) return false;
            if (c->type == HDB_TEXT) {
                cond->s = cJSON_IsString(val) ? val->valuestring : "";
            } else if (c->type == HDB_I64) {
                cond->i = cJSON_IsNumber(val) ? (int64_t)val->valuedouble : 0;
            } else {
                cond->f = cJSON_IsNumber(val) ? val->valuedouble : 0;
            }
            q->cond_count++;
        }
    }

    const cJSON *order = cJSON_GetObjectItemCaseSensitive(payload, "orderBy");
    if (cJSON_IsString(order) && find_col(order->valuestring) != NULL) {
        q->order_by = find_col(order->valuestring)->name;
    }
    q->descending = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(payload, "desc"));
    const cJSON *limit = cJSON_GetObjectItemCaseSensitive(payload, "limit");
    if (cJSON_IsNumber(limit) && limit->valuedouble > 0) q->limit = (size_t)limit->valuedouble;
    const cJSON *offset = cJSON_GetObjectItemCaseSensitive(payload, "offset");
    if (cJSON_IsNumber(offset) && offset->valuedouble > 0) q->offset = (size_t)offset->valuedouble;
    return true;
}


static esp_err_t handle_insert(const helix_service_invocation_t *inv, const cJSON *payload)
{
    user_row_t r = {0};
    apply_fields(&r, payload);
    uint32_t id = 0;
    if (hdb_insert(&USERS, &r, &id) != ESP_OK) {
        return service_dispatcher_fail(inv, "insert failed");
    }
    r.id = id;
    return service_dispatcher_respond(inv, "db-row", row_to_json(&r));
}

static esp_err_t handle_get(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(payload, "id");
    if (!cJSON_IsNumber(id)) return service_dispatcher_fail(inv, "get requires id");
    user_row_t r;
    if (hdb_get(&USERS, (uint32_t)id->valuedouble, &r) != ESP_OK) {
        return service_dispatcher_fail(inv, "not found");
    }
    return service_dispatcher_respond(inv, "db-row", row_to_json(&r));
}

static esp_err_t handle_update(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(payload, "id");
    if (!cJSON_IsNumber(id)) return service_dispatcher_fail(inv, "update requires id");
    uint32_t uid = (uint32_t)id->valuedouble;
    user_row_t r;
    if (hdb_get(&USERS, uid, &r) != ESP_OK) {
        return service_dispatcher_fail(inv, "not found");
    }
    apply_fields(&r, payload);  // overlay only provided fields
    if (hdb_update(&USERS, uid, &r) != ESP_OK) {
        return service_dispatcher_fail(inv, "update failed");
    }
    return service_dispatcher_respond(inv, "db-row", row_to_json(&r));
}

static esp_err_t handle_delete(const helix_service_invocation_t *inv, const cJSON *payload)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(payload, "id");
    if (!cJSON_IsNumber(id)) return service_dispatcher_fail(inv, "delete requires id");
    esp_err_t err = hdb_delete(&USERS, (uint32_t)id->valuedouble);
    if (err != ESP_OK) return service_dispatcher_fail(inv, "not found");
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "deleted", 1);
    return service_dispatcher_respond(inv, "db-ok", o);
}

static esp_err_t handle_select(const helix_service_invocation_t *inv, const cJSON *payload)
{
    hdb_query_t q;
    hdb_cond_t conds[MAX_CONDS];
    if (!parse_query(payload, &q, conds)) {
        return service_dispatcher_fail(inv, "bad query");
    }
    user_row_t rows[MAX_SELECT_ROWS];
    int n = hdb_select(&USERS, &q, rows, MAX_SELECT_ROWS);
    if (n < 0) return service_dispatcher_fail(inv, "select failed");

    cJSON *arr = cJSON_CreateArray();
    for (int i = 0; i < n; i++) {
        cJSON_AddItemToArray(arr, row_to_json(&rows[i]));
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "count", n);
    cJSON_AddItemToObject(o, "rows", arr);
    return service_dispatcher_respond(inv, "db-rows", o);
}

static esp_err_t handle_count(const helix_service_invocation_t *inv, const cJSON *payload)
{
    hdb_query_t q;
    hdb_cond_t conds[MAX_CONDS];
    if (!parse_query(payload, &q, conds)) return service_dispatcher_fail(inv, "bad query");
    int n = hdb_count(&USERS, &q);
    if (n < 0) return service_dispatcher_fail(inv, "count failed");
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "count", n);
    return service_dispatcher_respond(inv, "db-count", o);
}

static esp_err_t handle_delete_where(const helix_service_invocation_t *inv, const cJSON *payload)
{
    hdb_query_t q;
    hdb_cond_t conds[MAX_CONDS];
    if (!parse_query(payload, &q, conds)) return service_dispatcher_fail(inv, "bad query");
    int n = hdb_delete_where(&USERS, &q);
    if (n < 0) return service_dispatcher_fail(inv, "delete failed");
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "deleted", n);
    return service_dispatcher_respond(inv, "db-ok", o);
}

static esp_err_t db_service_handle_command(
    const helix_service_invocation_t *inv, const char *method, const cJSON *payload)
{
    if (!strcmp(method, "insert")) return handle_insert(inv, payload);
    if (!strcmp(method, "get")) return handle_get(inv, payload);
    if (!strcmp(method, "update")) return handle_update(inv, payload);
    if (!strcmp(method, "delete")) return handle_delete(inv, payload);
    if (!strcmp(method, "select")) return handle_select(inv, payload);
    if (!strcmp(method, "count")) return handle_count(inv, payload);
    if (!strcmp(method, "deleteWhere")) return handle_delete_where(inv, payload);
    return service_dispatcher_fail(inv, "unknown db method");
}

esp_err_t helix_db_service_start(void)
{
    if (!helix_db_ready()) {
        ESP_LOGW(TAG, "db not ready; service not registered");
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = service_dispatcher_register(DB_SERVICE, db_service_handle_command);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "db service started (table 'users')");
    }
    return err;
}

#else /* !CONFIG_HELIX_DB */

esp_err_t helix_db_service_start(void) { return ESP_OK; }

#endif /* CONFIG_HELIX_DB */
