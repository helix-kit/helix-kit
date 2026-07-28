#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "cJSON.h"
#include "esp_err.h"

typedef enum {
    HELIX_JSON_FIELD_STRING,
    HELIX_JSON_FIELD_INT,
    HELIX_JSON_FIELD_BOOL,
    HELIX_JSON_FIELD_VALUE,
} helix_json_field_type_t;

typedef struct {
    const char *name;
    helix_json_field_type_t type;
    size_t offset;
    bool required;
} helix_json_field_t;

#define HELIX_JSON_FIELD(struct_type, member, json_name, field_type, is_required) \
    { \
        .name = (json_name), \
        .type = (field_type), \
        .offset = offsetof(struct_type, member), \
        .required = (is_required), \
    }

#define HELIX_ARRAY_SIZE(values) (sizeof(values) / sizeof((values)[0]))

esp_err_t helix_json_decode_object(
    const cJSON *object,
    void *out,
    size_t out_size,
    const helix_json_field_t *fields,
    size_t field_count
);
