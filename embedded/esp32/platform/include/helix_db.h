#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// On-device single-table store on FlashDB (KVDB): SQLite-like CRUD (WHERE/ORDER BY/LIMIT/OFFSET/COUNT) for one table at a time, no joins.

// Initialise the KVDB backend once during boot (FAL over the `flashdb` partition). Safe to call repeatedly.
esp_err_t helix_db_init(void);

// True once the KVDB backend is mounted.
bool helix_db_ready(void);

typedef enum {
    HDB_I64,
    HDB_F64,
    HDB_TEXT,
} hdb_type_t;

typedef struct {
    const char *name;
    hdb_type_t type;
    uint16_t offset;  // byte offset within the row struct
    uint16_t size;    // capacity in bytes (TEXT columns only)
} hdb_column_t;

typedef struct {
    const char *name;             // table name (namespaces keys within the KVDB)
    const hdb_column_t *columns;
    size_t column_count;
    size_t row_size;              // sizeof the app's row struct
} hdb_table_t;

typedef enum { HDB_EQ, HDB_NE, HDB_LT, HDB_LE, HDB_GT, HDB_GE, HDB_LIKE } hdb_op_t;

typedef struct {
    const char *column;
    hdb_op_t op;
    int64_t i;         // value for HDB_I64
    double f;          // value for HDB_F64
    const char *s;     // value for HDB_TEXT / HDB_LIKE (substring)
} hdb_cond_t;

typedef struct {
    const hdb_cond_t *conds;   // AND-combined; NULL/0 = match all
    size_t cond_count;
    const char *order_by;      // column name; NULL = ascending id order
    bool descending;
    size_t limit;              // 0 = no limit
    size_t offset;             // rows to skip (after ordering)
} hdb_query_t;

// Insert a row; assigns and returns a new auto-increment id in *out_id.
esp_err_t hdb_insert(const hdb_table_t *table, const void *row, uint32_t *out_id);
// Fetch row by id into row_out (table->row_size bytes). ESP_ERR_NOT_FOUND if absent.
esp_err_t hdb_get(const hdb_table_t *table, uint32_t id, void *row_out);
// Overwrite an existing row. ESP_ERR_NOT_FOUND if the id does not exist.
esp_err_t hdb_update(const hdb_table_t *table, uint32_t id, const void *row);
// Delete a row by id. ESP_ERR_NOT_FOUND if absent.
esp_err_t hdb_delete(const hdb_table_t *table, uint32_t id);

// Query rows (WHERE/ORDER BY/LIMIT/OFFSET) into rows_out (capacity max_rows); returns rows written, negative esp_err_t on failure.
int hdb_select(const hdb_table_t *table, const hdb_query_t *query, void *rows_out, size_t max_rows);

// Count rows matching a filter (order/limit/offset ignored). Negative on error.
int hdb_count(const hdb_table_t *table, const hdb_query_t *query);

// Delete all rows matching a filter. Returns count deleted, negative on error.
int hdb_delete_where(const hdb_table_t *table, const hdb_query_t *query);

#ifdef __cplusplus
}
#endif
