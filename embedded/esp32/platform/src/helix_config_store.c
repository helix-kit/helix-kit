#include "helix_config_store.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "nvs.h"

static esp_err_t build_key(const char *domain, const char *key, char *out, size_t out_len)
{
    if (domain == NULL || domain[0] == '\0' || key == NULL || key[0] == '\0' || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    int written = snprintf(out, out_len, "%s.%s", domain, key);
    if (written < 0 || (size_t)written >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

static esp_err_t build_namespace(const char *domain, char *out, size_t out_len)
{
    if (domain == NULL || domain[0] == '\0' || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    int written = snprintf(out, out_len, "hx_%s", domain);
    if (written < 0 || (size_t)written >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

static esp_err_t read_string_from_namespace(
    const char *namespace_name,
    const char *key,
    char *out,
    size_t out_len
)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open(namespace_name, NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    size_t len = out_len;
    err = nvs_get_str(nvs, key, out, &len);
    nvs_close(nvs);
    if (err != ESP_OK) {
        return err;
    }
    if (len > out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

esp_err_t helix_config_get_string(
    const char *domain,
    const char *key,
    char *out,
    size_t out_len
)
{
    if (out == NULL || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    char namespace_name[16];
    esp_err_t err = build_namespace(domain, namespace_name, sizeof(namespace_name));
    if (err != ESP_OK) {
        return err;
    }
    err = read_string_from_namespace(namespace_name, key, out, out_len);
    if (err == ESP_OK) {
        return ESP_OK;
    }

    char nvs_key[HELIX_CONFIG_KEY_MAX_BYTES];
    err = build_key(domain, key, nvs_key, sizeof(nvs_key));
    if (err != ESP_OK) {
        return err;
    }
    return read_string_from_namespace(HELIX_CONFIG_NAMESPACE, nvs_key, out, out_len);
}

esp_err_t helix_config_set_string(const char *domain, const char *key, const char *value)
{
    if (value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    char namespace_name[16];
    esp_err_t err = build_namespace(domain, namespace_name, sizeof(namespace_name));
    if (err != ESP_OK) {
        return err;
    }

    nvs_handle_t nvs;
    err = nvs_open(namespace_name, NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(nvs, key, value);
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return err;
}

esp_err_t helix_config_erase_domain(const char *domain)
{
    if (domain == NULL || domain[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    char namespace_name[16];
    esp_err_t err = build_namespace(domain, namespace_name, sizeof(namespace_name));
    if (err == ESP_OK) {
        nvs_handle_t domain_nvs;
        err = nvs_open(namespace_name, NVS_READWRITE, &domain_nvs);
        if (err == ESP_OK) {
            err = nvs_erase_all(domain_nvs);
            if (err == ESP_OK) {
                err = nvs_commit(domain_nvs);
            }
            nvs_close(domain_nvs);
        } else if (err == ESP_ERR_NVS_NOT_FOUND) {
            err = ESP_OK;
        }
    }
    if (err != ESP_OK) {
        return err;
    }

    nvs_handle_t nvs;
    err = nvs_open(HELIX_CONFIG_NAMESPACE, NVS_READWRITE, &nvs);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    nvs_iterator_t it = NULL;
    err = nvs_entry_find("nvs", HELIX_CONFIG_NAMESPACE, NVS_TYPE_STR, &it);
    while (err == ESP_OK && it != NULL) {
        nvs_entry_info_t info;
        nvs_entry_info(it, &info);
        char prefix[HELIX_CONFIG_KEY_MAX_BYTES];
        if (snprintf(prefix, sizeof(prefix), "%s.", domain) < (int)sizeof(prefix) &&
            strncmp(info.key, prefix, strlen(prefix)) == 0) {
            esp_err_t erase_err = nvs_erase_key(nvs, info.key);
            if (erase_err != ESP_OK) {
                nvs_release_iterator(it);
                nvs_close(nvs);
                return erase_err;
            }
        }
        err = nvs_entry_next(&it);
    }
    if (it != NULL) {
        nvs_release_iterator(it);
    }
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        err = ESP_OK;
    }
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return err;
}

esp_err_t helix_config_get_required_string(
    const char *domain,
    const char *key,
    char *out,
    size_t out_len,
    const char *log_tag
)
{
    esp_err_t err = helix_config_get_string(domain, key, out, out_len);
    if (err != ESP_OK && log_tag != NULL) {
        ESP_LOGW(log_tag, "missing config %s.%s: %s", domain, key, esp_err_to_name(err));
    }
    return err;
}

esp_err_t helix_config_get_optional_string(const char *domain, const char *key, char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = helix_config_get_string(domain, key, out, out_len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        out[0] = '\0';
        return ESP_OK;
    }
    return err;
}

bool helix_config_overlay_string(char *out, size_t out_len, const cJSON *values, const char *key)
{
    if (out == NULL || out_len == 0 || values == NULL || key == NULL) {
        return false;
    }

    const cJSON *value = cJSON_GetObjectItemCaseSensitive(values, key);
    if (value == NULL) {
        return true;
    }
    if (!cJSON_IsString(value) || strlen(value->valuestring) >= out_len) {
        return false;
    }
    strlcpy(out, value->valuestring, out_len);
    return true;
}

bool helix_config_parse_u16(const char *value, uint16_t *out)
{
    if (value == NULL || out == NULL) {
        return false;
    }

    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (value[0] == '\0' || end == NULL || *end != '\0' || parsed <= 0 || parsed > UINT16_MAX) {
        return false;
    }
    *out = (uint16_t)parsed;
    return true;
}

esp_err_t helix_config_overlay_u16(uint16_t *out, const cJSON *values, const char *key)
{
    if (out == NULL || values == NULL || key == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *value = cJSON_GetObjectItemCaseSensitive(values, key);
    if (value == NULL) {
        return ESP_OK;
    }

    char value_string[8];
    if (cJSON_IsString(value)) {
        strlcpy(value_string, value->valuestring, sizeof(value_string));
    } else if (cJSON_IsNumber(value)) {
        snprintf(value_string, sizeof(value_string), "%d", value->valueint);
    } else {
        return ESP_ERR_INVALID_ARG;
    }
    return helix_config_parse_u16(value_string, out) ? ESP_OK : ESP_ERR_INVALID_ARG;
}
