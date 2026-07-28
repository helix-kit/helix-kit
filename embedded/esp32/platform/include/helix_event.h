#pragma once

#include "cJSON.h"
#include "esp_err.h"

// Publishes a device event on the given service; takes ownership of `payload` and frees it.
esp_err_t helix_event_publish(const char *service, const char *type, cJSON *payload, int *out_msg_id);
