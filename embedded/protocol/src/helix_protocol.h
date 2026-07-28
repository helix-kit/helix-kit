#pragma once

#include <stddef.h>

#include "cJSON.h"
#include "esp_err.h"

#define HELIX_PROTOCOL_SERVICE_MAX_BYTES 48
#define HELIX_PROTOCOL_METHOD_MAX_BYTES 80
#define HELIX_PROTOCOL_REQUEST_ID_MAX_BYTES 80

typedef struct {
    char request_id[HELIX_PROTOCOL_REQUEST_ID_MAX_BYTES];
    char service[HELIX_PROTOCOL_SERVICE_MAX_BYTES];
    char method[HELIX_PROTOCOL_METHOD_MAX_BYTES];
    cJSON *payload;
} helix_protocol_packet_t;

esp_err_t helix_protocol_parse_packet(
    const char *json,
    size_t json_len,
    helix_protocol_packet_t *out
);

void helix_protocol_packet_free(helix_protocol_packet_t *packet);

esp_err_t helix_protocol_build_packet_json(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id,
    char **out_json
);
