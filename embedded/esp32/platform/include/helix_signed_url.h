#pragma once

#include <stdbool.h>

#include "cloud.h"
#include "esp_err.h"

#define HELIX_SIGNED_URL_MAX_BYTES 512
#define HELIX_SIGNED_URL_METHOD_MAX_BYTES 8
#define HELIX_SIGNED_URL_HEADERS_MAX_BYTES 1024

typedef struct {
    const helix_cloud_config_t *cloud_config;
    const char *session_path;
    const char *object_path;
    const char *content_type;
    bool include_device_id;
} helix_signed_url_request_t;

typedef struct {
    char url[HELIX_SIGNED_URL_MAX_BYTES];
    char method[HELIX_SIGNED_URL_METHOD_MAX_BYTES];
    char headers_json[HELIX_SIGNED_URL_HEADERS_MAX_BYTES];
} helix_signed_url_t;

esp_err_t helix_signed_url_request(
    const helix_signed_url_request_t *request,
    helix_signed_url_t *signed_url
);
