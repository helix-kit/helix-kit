#pragma once

#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

typedef union {
    max_align_t _alignment;
    uint8_t _opaque[160];
} helix_service_invocation_t;

typedef esp_err_t (*service_command_handler_t)(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
);

esp_err_t service_dispatcher_register(const char *service, service_command_handler_t handler);
esp_err_t service_dispatcher_call(const char *service, const char *method, const cJSON *payload);
esp_err_t service_dispatcher_respond(
    const helix_service_invocation_t *invocation,
    const char *method,
    cJSON *payload
);
esp_err_t service_dispatcher_publish(const char *service, const char *method, cJSON *payload);
esp_err_t service_dispatcher_fail(
    const helix_service_invocation_t *invocation,
    const char *error
);
