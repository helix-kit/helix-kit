#pragma once

#include "cJSON.h"
#include "esp_err.h"

// Publishes a device event on the given service. Wraps `payload` in the
// {type, msgId, timestamp, payload} envelope and publishes it to
// helix/device/<id>/service/<service>/event over the MQTT transport. Takes
// ownership of `payload` and frees it on both success and failure.
esp_err_t helix_event_publish(const char *service, const char *type, cJSON *payload, int *out_msg_id);
