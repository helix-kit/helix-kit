#include "helix_provisioning.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "helix_config_store.h"
#include "nvs.h"
#include "service_dispatcher.h"

#define HELIX_PROVISIONING_MAX_DOMAINS 8
#define HELIX_PROVISIONING_RESTART_DELAY_MS 300

static const char *TAG = "helix_provisioning";
static helix_provisioning_domain_t s_domains[HELIX_PROVISIONING_MAX_DOMAINS];
static size_t s_domain_count;

static const helix_provisioning_domain_t *find_domain(const char *domain)
{
    if (domain == NULL) {
        return NULL;
    }
    for (size_t i = 0; i < s_domain_count; i++) {
        if (strcmp(s_domains[i].domain, domain) == 0) {
            return &s_domains[i];
        }
    }
    return NULL;
}

static const char *json_string(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static char *value_to_string(const cJSON *value)
{
    if (cJSON_IsString(value)) {
        return strdup(value->valuestring);
    }
    if (cJSON_IsNumber(value)) {
        char buffer[32];
        snprintf(buffer, sizeof(buffer), "%d", value->valueint);
        return strdup(buffer);
    }
    if (cJSON_IsBool(value)) {
        return strdup(cJSON_IsTrue(value) ? "true" : "false");
    }
    return NULL;
}

static esp_err_t add_status(
    const helix_service_invocation_t *invocation,
    const char *status,
    const char *message,
    bool restart_required
)
{
    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(payload, "status", status);
    if (message != NULL) {
        cJSON_AddStringToObject(payload, "message", message);
    }
    cJSON_AddBoolToObject(payload, "restartRequired", restart_required);
    return service_dispatcher_respond(invocation, HELIX_PROVISIONING_STATUS_MESSAGE, payload);
}

static esp_err_t handle_describe_config(const helix_service_invocation_t *invocation)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON *domains = cJSON_CreateArray();
    if (payload == NULL || domains == NULL) {
        cJSON_Delete(payload);
        cJSON_Delete(domains);
        return ESP_ERR_NO_MEM;
    }

    for (size_t i = 0; i < s_domain_count; i++) {
        const helix_provisioning_domain_t *domain = &s_domains[i];
        cJSON *domain_json = cJSON_CreateObject();
        cJSON *fields = cJSON_CreateArray();
        if (domain_json == NULL || fields == NULL) {
            cJSON_Delete(payload);
            cJSON_Delete(domain_json);
            cJSON_Delete(fields);
            return ESP_ERR_NO_MEM;
        }
        cJSON_AddStringToObject(domain_json, "domain", domain->domain);
        cJSON_AddStringToObject(domain_json, "label", domain->label != NULL ? domain->label : domain->domain);
        cJSON_AddBoolToObject(domain_json, "restartRequired", domain->restart_required);
        for (size_t j = 0; j < domain->field_count; j++) {
            const helix_provisioning_field_t *field = &domain->fields[j];
            cJSON *field_json = cJSON_CreateObject();
            if (field_json == NULL) {
                cJSON_Delete(payload);
                cJSON_Delete(domain_json);
                cJSON_Delete(fields);
                return ESP_ERR_NO_MEM;
            }
            cJSON_AddStringToObject(field_json, "key", field->key);
            cJSON_AddStringToObject(field_json, "label", field->label != NULL ? field->label : field->key);
            cJSON_AddBoolToObject(field_json, "required", field->required);
            cJSON_AddBoolToObject(field_json, "secret", field->secret);
            cJSON_AddItemToArray(fields, field_json);
        }
        cJSON_AddItemToObject(domain_json, "fields", fields);
        cJSON_AddItemToArray(domains, domain_json);
    }

    cJSON_AddItemToObject(payload, "domains", domains);
    return service_dispatcher_respond(invocation, HELIX_PROVISIONING_CONFIG_MESSAGE, payload);
}

static esp_err_t add_domain_config(cJSON *domains, const helix_provisioning_domain_t *domain)
{
    cJSON *values = cJSON_CreateObject();
    if (values == NULL) {
        return ESP_ERR_NO_MEM;
    }

    for (size_t i = 0; i < domain->field_count; i++) {
        const helix_provisioning_field_t *field = &domain->fields[i];
        char value[HELIX_CONFIG_VALUE_MAX_BYTES];
        esp_err_t err = helix_config_get_string(domain->domain, field->key, value, sizeof(value));
        if (err == ESP_OK) {
            cJSON_AddStringToObject(values, field->key, field->secret ? "" : value);
        } else if (err != ESP_ERR_NVS_NOT_FOUND) {
            cJSON_Delete(values);
            return err;
        }
    }
    cJSON_AddItemToObject(domains, domain->domain, values);
    return ESP_OK;
}

static esp_err_t handle_get_config(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    const char *requested_domain = payload != NULL ? json_string(payload, "domain") : NULL;
    cJSON *response = cJSON_CreateObject();
    cJSON *domains = cJSON_CreateObject();
    if (response == NULL || domains == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(domains);
        return ESP_ERR_NO_MEM;
    }

    if (requested_domain != NULL) {
        const helix_provisioning_domain_t *domain = find_domain(requested_domain);
        if (domain == NULL) {
            cJSON_Delete(response);
            cJSON_Delete(domains);
            return service_dispatcher_fail(invocation, "unknown config domain");
        }
        esp_err_t err = add_domain_config(domains, domain);
        if (err != ESP_OK) {
            cJSON_Delete(response);
            cJSON_Delete(domains);
            return service_dispatcher_fail(invocation, esp_err_to_name(err));
        }
    } else {
        for (size_t i = 0; i < s_domain_count; i++) {
            esp_err_t err = add_domain_config(domains, &s_domains[i]);
            if (err != ESP_OK) {
                cJSON_Delete(response);
                cJSON_Delete(domains);
                return service_dispatcher_fail(invocation, esp_err_to_name(err));
            }
        }
    }

    cJSON_AddItemToObject(response, "domains", domains);
    return service_dispatcher_respond(invocation, HELIX_PROVISIONING_CONFIG_MESSAGE, response);
}

static esp_err_t persist_values(const helix_provisioning_domain_t *domain, const cJSON *values)
{
    for (size_t i = 0; i < domain->field_count; i++) {
        const helix_provisioning_field_t *field = &domain->fields[i];
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(values, field->key);
        if (value == NULL) {
            continue;
        }
        char *string_value = value_to_string(value);
        if (string_value == NULL) {
            return ESP_ERR_INVALID_ARG;
        }
        esp_err_t err = helix_config_set_string(domain->domain, field->key, string_value);
        free(string_value);
        if (err != ESP_OK) {
            return err;
        }
    }
    return ESP_OK;
}

static esp_err_t validate_required_fields(const helix_provisioning_domain_t *domain, const cJSON *values)
{
    for (size_t i = 0; i < domain->field_count; i++) {
        const helix_provisioning_field_t *field = &domain->fields[i];
        if (!field->required) {
            continue;
        }
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(values, field->key);
        if (value == NULL) {
            char existing[HELIX_CONFIG_VALUE_MAX_BYTES];
            esp_err_t err = helix_config_get_string(domain->domain, field->key, existing, sizeof(existing));
            if (err != ESP_OK || existing[0] == '\0') {
                ESP_LOGW(TAG, "missing required config field %s.%s", domain->domain, field->key);
                return ESP_ERR_INVALID_ARG;
            }
            continue;
        }
        if (!cJSON_IsString(value) && !cJSON_IsNumber(value) && !cJSON_IsBool(value)) {
            return ESP_ERR_INVALID_ARG;
        }
    }
    return ESP_OK;
}

static esp_err_t handle_set_config(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    if (payload == NULL || !cJSON_IsObject(payload)) {
        return service_dispatcher_fail(invocation, "payload object is required");
    }
    const char *domain_name = json_string(payload, "domain");
    const cJSON *values = cJSON_GetObjectItemCaseSensitive(payload, "values");
    const cJSON *force_json = cJSON_GetObjectItemCaseSensitive(payload, "force");
    bool force = cJSON_IsTrue(force_json);
    if (domain_name == NULL || !cJSON_IsObject(values)) {
        return service_dispatcher_fail(invocation, "domain and values are required");
    }

    const helix_provisioning_domain_t *domain = find_domain(domain_name);
    if (domain == NULL) {
        return service_dispatcher_fail(invocation, "unknown config domain");
    }

    esp_err_t err = validate_required_fields(domain, values);
    if (err == ESP_OK && domain->validate != NULL) {
        err = domain->validate(domain->domain, values, force, domain->context);
    }
    if (err != ESP_OK) {
        add_status(invocation, "rejected", esp_err_to_name(err), false);
        return err;
    }

    err = persist_values(domain, values);
    if (err != ESP_OK) {
        add_status(invocation, "store-failed", esp_err_to_name(err), false);
        return err;
    }

    add_status(invocation, "accepted", "configuration stored", domain->restart_required);
    ESP_LOGI(TAG, "accepted config domain=%s restart=%d", domain->domain, domain->restart_required);
    if (domain->restart_required) {
        vTaskDelay(pdMS_TO_TICKS(HELIX_PROVISIONING_RESTART_DELAY_MS));
        esp_restart();
    }
    return ESP_OK;
}

static esp_err_t provisioning_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (strcmp(method, HELIX_PROVISIONING_DESCRIBE_CONFIG_METHOD) == 0) {
        return handle_describe_config(invocation);
    }
    if (strcmp(method, HELIX_PROVISIONING_GET_CONFIG_METHOD) == 0) {
        return handle_get_config(invocation, payload);
    }
    if (strcmp(method, HELIX_PROVISIONING_SET_CONFIG_METHOD) == 0) {
        return handle_set_config(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unknown provisioning command");
}

esp_err_t helix_provisioning_register_domain(const helix_provisioning_domain_t *domain)
{
    if (domain == NULL || domain->domain == NULL || domain->domain[0] == '\0' ||
        domain->fields == NULL || domain->field_count == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (find_domain(domain->domain) != NULL) {
        return ESP_OK;
    }
    if (s_domain_count >= HELIX_PROVISIONING_MAX_DOMAINS) {
        return ESP_ERR_NO_MEM;
    }
    s_domains[s_domain_count++] = *domain;
    ESP_LOGI(TAG, "registered config domain=%s", domain->domain);
    return ESP_OK;
}

esp_err_t helix_provisioning_start(void)
{
    ESP_LOGI(TAG, "starting Helix provisioning service");
    return service_dispatcher_register(HELIX_PROVISIONING_SERVICE, provisioning_handle_command);
}
