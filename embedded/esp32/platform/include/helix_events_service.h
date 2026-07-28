#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Register the `events` service on the message layer: query the local
// store-and-forward event queue over any transport (MQTT/WebSocket/BLE/serial).
// Methods (see contracts/events.json): stats, list, get, emit, sweep (+ a
// test-only simulate-delivery under CONFIG_HELIX_EVENTS_TEST_HOOKS).
// No-op returning ESP_OK when CONFIG_HELIX_EVENT_QUEUE is disabled.
esp_err_t helix_events_service_start(void);

#ifdef __cplusplus
}
#endif
