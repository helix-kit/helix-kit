#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the transport-agnostic file-transfer service (JSON `file` control plane: begin/commit/abort/stat) and subscribe to the binary side-channel for the in-order data chunks tagged by session.
esp_err_t helix_file_service_start(void);

#ifdef __cplusplus
}
#endif
