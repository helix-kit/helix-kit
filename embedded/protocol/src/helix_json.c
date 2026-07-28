#include "helix_json.h"

#include <stdint.h>
#include <string.h>

static esp_err_t decode_field(
    const cJSON *value,
    void *target,
    helix_json_field_type_t type
)
{
    switch (type) {
    case HELIX_JSON_FIELD_STRING:
        if (!cJSON_IsString(value)) {
            return ESP_ERR_INVALID_ARG;
        }
        *(char **)target = value->valuestring;
        return ESP_OK;
    case HELIX_JSON_FIELD_INT:
        if (!cJSON_IsNumber(value)) {
            return ESP_ERR_INVALID_ARG;
        }
        *(int *)target = value->valueint;
        return ESP_OK;
    case HELIX_JSON_FIELD_BOOL:
        if (!cJSON_IsBool(value)) {
            return ESP_ERR_INVALID_ARG;
        }
        *(bool *)target = cJSON_IsTrue(value);
        return ESP_OK;
    case HELIX_JSON_FIELD_VALUE:
        *(const cJSON **)target = value;
        return ESP_OK;
    default:
        return ESP_ERR_NOT_SUPPORTED;
    }
}

esp_err_t helix_json_decode_object(
    const cJSON *object,
    void *out,
    size_t out_size,
    const helix_json_field_t *fields,
    size_t field_count
)
{
    if (out == NULL || out_size == 0 || (field_count > 0 && fields == NULL)) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out, 0, out_size);
    if (object == NULL) {
        for (size_t i = 0; i < field_count; i++) {
            if (fields[i].required) {
                return ESP_ERR_INVALID_ARG;
            }
        }
        return ESP_OK;
    }
    if (!cJSON_IsObject(object)) {
        return ESP_ERR_INVALID_ARG;
    }

    for (size_t i = 0; i < field_count; i++) {
        const helix_json_field_t *field = &fields[i];
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(object, field->name);
        if (value == NULL || cJSON_IsNull(value)) {
            if (field->required) {
                return ESP_ERR_INVALID_ARG;
            }
            continue;
        }
        esp_err_t err = decode_field(
            value,
            (uint8_t *)out + field->offset,
            field->type
        );
        if (err != ESP_OK) {
            return err;
        }
    }
    return ESP_OK;
}
