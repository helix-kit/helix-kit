#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the transport-agnostic file-transfer service on the message layer
// and subscribe to the binary data side-channel. No-op returning ESP_OK when
// CONFIG_HELIX_FILE_TRANSFER is disabled.
//
// Control plane (JSON `file` service):
//   begin  {dest, size?, sha256?, chunkSize?} -> file-begin  {session, maxChunk, resumeOffset}
//   commit {session, sha256?}                 -> file-commit {session, ok, size, sha256}
//   abort  {session}                          -> file-abort  {session}
//   stat   {dest}                             -> file-stat   {exists, size, sha256}
// Data plane: binary chunks tagged with the `session` handle returned by begin,
// delivered in order over the binary channel (serial framing / BLE characteristic).
esp_err_t helix_file_service_start(void);

#ifdef __cplusplus
}
#endif
