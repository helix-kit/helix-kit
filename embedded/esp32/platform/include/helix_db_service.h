#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the `db` service: SQLite-like CRUD (insert/get/update/delete/select/count/deleteWhere) over a demo `users` table backed by helix_db. Reference for wiring a table to the wire.
esp_err_t helix_db_service_start(void);

#ifdef __cplusplus
}
#endif
