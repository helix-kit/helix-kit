#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the `events` service: query the local store-and-forward event queue (stats/list/get/emit/sweep) over any transport.
esp_err_t helix_events_service_start(void);

#ifdef __cplusplus
}
#endif
