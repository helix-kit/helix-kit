#include "helix_ota.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_err.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "cloud.h"
#include "helix_signed_url.h"
#include "ota_contract.h"
#include "service_dispatcher.h"

#define OTA_TASK_STACK_BYTES 12288
#define OTA_HTTP_BUFFER_BYTES 4096
#define OTA_HTTP_TIMEOUT_MS 60000
#define OTA_URL_MAX_BYTES 512
#define OTA_PATH_MAX_BYTES 256
#define OTA_VERSION_MAX_BYTES 64
#define OTA_SHA256_MAX_BYTES 80

typedef enum {
    OTA_SOURCE_DIRECT_URL,
    OTA_SOURCE_PACKAGE_PATH,
    OTA_SOURCE_DEVICE_PATH,
} ota_source_t;

typedef struct {
    ota_source_t source;
    char url[OTA_URL_MAX_BYTES];
    char path[OTA_PATH_MAX_BYTES];
    char version[OTA_VERSION_MAX_BYTES];
    char sha256[OTA_SHA256_MAX_BYTES];
    helix_service_invocation_t invocation;
} ota_request_t;

static const char *TAG = "ota";

static helix_cloud_config_t s_config;
static bool s_ota_running;

static esp_err_t ota_service_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
);

static bool string_matches(const char *value, const char *expected)
{
    return value != NULL && strcmp(value, expected) == 0;
}

static esp_err_t copy_optional(char *out, size_t out_len, const char *value)
{
    out[0] = '\0';
    if (value == NULL || value[0] == '\0') {
        return ESP_OK;
    }
    if (strlen(value) >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    strlcpy(out, value, out_len);
    return ESP_OK;
}

static esp_err_t publish_ota_status(const char *state, const char *message, const ota_request_t *request)
{
    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        cJSON_Delete(payload);
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(payload, "state", state);
    cJSON_AddStringToObject(payload, "firmwareVersion", CONFIG_DEVICE_FIRMWARE_VERSION);
    if (message != NULL) {
        cJSON_AddStringToObject(payload, "message", message);
    }
    if (request != NULL) {
        if (request->version[0] != '\0') {
            cJSON_AddStringToObject(payload, "targetVersion", request->version);
        }
        if (request->sha256[0] != '\0') {
            cJSON_AddStringToObject(payload, "sha256", request->sha256);
        }
    }
    if (request != NULL) {
        return service_dispatcher_respond(&request->invocation, OTA_STATUS_MESSAGE, payload);
    }
    return service_dispatcher_publish(OTA_SERVICE, OTA_STATUS_MESSAGE, payload);
}

static esp_err_t request_signed_download_url(const ota_request_t *request, char *out_url, size_t out_url_len)
{
    const char *path_config = request->source == OTA_SOURCE_PACKAGE_PATH
                                  ? CONFIG_OTA_PACKAGE_DOWNLOAD_SESSION_PATH
                                  : CONFIG_OTA_DEVICE_DOWNLOAD_SESSION_PATH;
    helix_signed_url_t signed_url = {0};
    helix_signed_url_request_t signed_url_request = {
        .cloud_config = &s_config,
        .session_path = path_config,
        .object_path = request->path,
        .include_device_id = true,
    };

    esp_err_t err = helix_signed_url_request(&signed_url_request, &signed_url);
    if (err != ESP_OK) {
        return err;
    }
    if (!string_matches(signed_url.method, "GET") || strlen(signed_url.url) >= out_url_len) {
        return ESP_ERR_INVALID_RESPONSE;
    }
    strlcpy(out_url, signed_url.url, out_url_len);
    return ESP_OK;
}

static esp_err_t run_https_ota(const char *url)
{
    esp_http_client_config_t http_config = {
        .url = url,
        .timeout_ms = OTA_HTTP_TIMEOUT_MS,
        .buffer_size = OTA_HTTP_BUFFER_BYTES,
        .buffer_size_tx = OTA_HTTP_BUFFER_BYTES,
        .keep_alive_enable = false,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_https_ota_config_t ota_config = {
        .http_config = &http_config,
    };

    ESP_LOGI(TAG, "starting OTA from %s", url);
    return esp_https_ota(&ota_config);
}

static char hex_digit(uint8_t value)
{
    return value < 10 ? (char)('0' + value) : (char)('a' + value - 10);
}

static esp_err_t verify_boot_partition_sha256(const ota_request_t *request)
{
    if (request->sha256[0] == '\0') {
        return ESP_OK;
    }
    if (strlen(request->sha256) != 64) {
        ESP_LOGE(TAG, "invalid expected OTA sha256 length");
        return ESP_ERR_INVALID_ARG;
    }

    const esp_partition_t *boot_partition = esp_ota_get_boot_partition();
    if (boot_partition == NULL) {
        return ESP_ERR_NOT_FOUND;
    }

    uint8_t digest[32];
    esp_err_t err = esp_partition_get_sha256(boot_partition, digest);
    if (err != ESP_OK) {
        return err;
    }

    char actual[65];
    for (size_t i = 0; i < sizeof(digest); i++) {
        actual[i * 2] = hex_digit((uint8_t)(digest[i] >> 4));
        actual[i * 2 + 1] = hex_digit((uint8_t)(digest[i] & 0x0f));
    }
    actual[64] = '\0';

    if (strcasecmp(actual, request->sha256) != 0) {
        ESP_LOGE(TAG, "OTA sha256 mismatch expected=%s actual=%s", request->sha256, actual);
        const esp_partition_t *running = esp_ota_get_running_partition();
        if (running != NULL) {
            esp_err_t restore_err = esp_ota_set_boot_partition(running);
            if (restore_err != ESP_OK) {
                ESP_LOGE(TAG, "failed to restore running boot partition: %s", esp_err_to_name(restore_err));
            }
        }
        return ESP_ERR_INVALID_CRC;
    }

    ESP_LOGI(TAG, "OTA sha256 verified: %s", actual);
    return ESP_OK;
}

static esp_err_t parse_ota_request_payload(const cJSON *payload, ota_request_t *request)
{
    memset(request, 0, sizeof(*request));

    ota_ota_update_request_t decoded;
    esp_err_t err = ota_parse_ota_update_request(payload, &decoded);
    if (err != ESP_OK) {
        return err;
    }

    err = copy_optional(request->version, sizeof(request->version), decoded.version);
    if (err == ESP_OK) {
        err = copy_optional(request->sha256, sizeof(request->sha256), decoded.sha256);
    }
    if (err != ESP_OK) {
        return err;
    }

    if (decoded.firmware_url != NULL && decoded.firmware_url[0] != '\0') {
        request->source = OTA_SOURCE_DIRECT_URL;
        err = copy_optional(request->url, sizeof(request->url), decoded.firmware_url);
    } else if (decoded.package_path != NULL && decoded.package_path[0] != '\0') {
        request->source = OTA_SOURCE_PACKAGE_PATH;
        err = copy_optional(request->path, sizeof(request->path), decoded.package_path);
    } else if (decoded.device_path != NULL && decoded.device_path[0] != '\0') {
        request->source = OTA_SOURCE_DEVICE_PATH;
        err = copy_optional(request->path, sizeof(request->path), decoded.device_path);
    } else {
        err = ESP_ERR_INVALID_ARG;
    }

    return err;
}

static void ota_task(void *arg)
{
    ota_request_t *request = (ota_request_t *)arg;
    char ota_url[OTA_URL_MAX_BYTES] = {0};

    publish_ota_status("accepted", NULL, request);

    esp_err_t err = ESP_OK;
    if (request->source == OTA_SOURCE_DIRECT_URL) {
        strlcpy(ota_url, request->url, sizeof(ota_url));
    } else {
        err = request_signed_download_url(request, ota_url, sizeof(ota_url));
    }

    if (err == ESP_OK) {
        publish_ota_status("downloading", NULL, request);
        err = run_https_ota(ota_url);
    }
    if (err == ESP_OK) {
        err = verify_boot_partition_sha256(request);
    }

    if (err == ESP_OK) {
        publish_ota_status("rebooting", "OTA applied successfully", request);
        ESP_LOGI(TAG, "OTA applied successfully; rebooting");
        free(request);
        vTaskDelay(pdMS_TO_TICKS(CONFIG_OTA_RESTART_DELAY_MS));
        esp_restart();
    }

    ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    publish_ota_status("failed", esp_err_to_name(err), request);
    s_ota_running = false;
    free(request);
    vTaskDelete(NULL);
}

static esp_err_t load_ota_config(void)
{
    memset(&s_config, 0, sizeof(s_config));
    return cloud_config_load(&s_config);
}

esp_err_t helix_ota_start(void)
{
    esp_err_t err = load_ota_config();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "OTA registered without device config: %s", esp_err_to_name(err));
    }

    err = esp_ota_mark_app_valid_cancel_rollback();
    if (err != ESP_OK && err != ESP_ERR_OTA_ROLLBACK_INVALID_STATE) {
        ESP_LOGW(TAG, "mark app valid skipped: %s", esp_err_to_name(err));
    }

    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    ESP_LOGI(TAG, "OTA ready running=%s next=%s",
             running != NULL ? running->label : "unknown",
             next != NULL ? next->label : "none");
    return service_dispatcher_register(OTA_SERVICE, ota_service_handle_command);
}

static esp_err_t ota_service_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (!string_matches(method, OTA_OTA_UPDATE_METHOD)) {
        return service_dispatcher_fail(invocation, "unsupported OTA command");
    }
    if (payload == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t config_err = load_ota_config();
    if (config_err != ESP_OK) {
        return service_dispatcher_fail(invocation, "device is not provisioned");
    }
    if (s_ota_running) {
        ESP_LOGW(TAG, "ignoring OTA command while OTA is already running");
        service_dispatcher_fail(invocation, "OTA already running");
        return ESP_ERR_INVALID_STATE;
    }

    ota_request_t *request = calloc(1, sizeof(*request));
    if (request == NULL) {
        return ESP_ERR_NO_MEM;
    }
    request->invocation = *invocation;

    esp_err_t err = parse_ota_request_payload(payload, request);
    if (err != ESP_OK) {
        service_dispatcher_fail(invocation, esp_err_to_name(err));
        free(request);
        ESP_LOGW(TAG, "invalid OTA command: %s", esp_err_to_name(err));
        return err;
    }

    s_ota_running = true;
    BaseType_t created = xTaskCreate(ota_task, "ota_update", OTA_TASK_STACK_BYTES, request, 5, NULL);
    if (created != pdPASS) {
        s_ota_running = false;
        free(request);
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}
