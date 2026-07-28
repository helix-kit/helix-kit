#pragma once

#include "service_dispatcher.h"

typedef esp_err_t (*service_response_sink_t)(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id
);

esp_err_t service_dispatcher_register_response_sink(service_response_sink_t sink);
esp_err_t service_dispatcher_handle(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id
);
