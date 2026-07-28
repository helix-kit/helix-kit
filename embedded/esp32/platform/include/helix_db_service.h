#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the `db` service on the message layer, exposing SQLite-like CRUD over
// a demo `users` table (columns: id, name, age, score) backed by helix_db /
// FlashDB. Serves as the reference for how an app wires a table to the wire.
// No-op returning ESP_OK when CONFIG_HELIX_DB is disabled.
//
// Methods (JSON payloads):
//   insert      {name, age, score}                          -> db-row    {id,name,age,score}
//   get         {id}                                        -> db-row    {...}
//   update      {id, name?, age?, score?}                   -> db-row    {...}
//   delete      {id}                                        -> db-ok     {deleted:1}
//   select      {where:[{col,op,val}], orderBy, desc,
//                limit, offset}                             -> db-rows   {count, rows:[...]}
//   count       {where:[...]}                               -> db-count  {count}
//   deleteWhere {where:[...]}                               -> db-ok     {deleted}
// `op` is one of: eq ne lt le gt ge like.
esp_err_t helix_db_service_start(void);

#ifdef __cplusplus
}
#endif
