#include "certificates.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/x509_csr.h"
#include "nvs.h"
#include "sdkconfig.h"

#define CERT_NAMESPACE "helix_certs"
#define NVS_KEY_PRIVATE "device_key"
#define NVS_KEY_CERT "device_crt"
#define NVS_KEY_CA "root_ca"
#define HTTP_RESPONSE_LIMIT_BYTES (24 * 1024)
#define HTTP_BUFFER_BYTES 4096
#define HTTP_ENROLLMENT_TIMEOUT_MS 30000
#define CSR_BUFFER_BYTES 4096
#define KEY_BUFFER_BYTES 2048

static const char *TAG = "certificates";

typedef struct {
    char *data;
    size_t len;
    size_t cap;
} http_response_buffer_t;

static esp_err_t read_nvs_string(nvs_handle_t nvs, const char *key, char **out)
{
    size_t len = 0;
    esp_err_t err = nvs_get_str(nvs, key, NULL, &len);
    if (err != ESP_OK) {
        return err;
    }

    char *value = calloc(1, len);
    if (value == NULL) {
        return ESP_ERR_NO_MEM;
    }

    err = nvs_get_str(nvs, key, value, &len);
    if (err != ESP_OK) {
        free(value);
        return err;
    }

    *out = value;
    return ESP_OK;
}

static esp_err_t load_bundle_from_nvs(mqtt_cert_bundle_t *bundle)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open(CERT_NAMESPACE, NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    err = read_nvs_string(nvs, NVS_KEY_PRIVATE, &bundle->private_key_pem);
    if (err == ESP_OK) {
        err = read_nvs_string(nvs, NVS_KEY_CERT, &bundle->certificate_pem);
    }
    if (err == ESP_OK) {
        err = read_nvs_string(nvs, NVS_KEY_CA, &bundle->root_ca_pem);
    }

    nvs_close(nvs);
    if (err != ESP_OK) {
        mqtt_cert_bundle_free(bundle);
    }
    return err;
}

static esp_err_t persist_bundle_to_nvs(const mqtt_cert_bundle_t *bundle)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open(CERT_NAMESPACE, NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(nvs, NVS_KEY_PRIVATE, bundle->private_key_pem);
    if (err == ESP_OK) {
        err = nvs_set_str(nvs, NVS_KEY_CERT, bundle->certificate_pem);
    }
    if (err == ESP_OK) {
        err = nvs_set_str(nvs, NVS_KEY_CA, bundle->root_ca_pem);
    }
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }

    nvs_close(nvs);
    return err;
}

static int mbedtls_rng(void *ctx, unsigned char *buf, size_t len)
{
    return mbedtls_ctr_drbg_random(ctx, buf, len);
}

static esp_err_t generate_key_and_csr(const helix_cloud_config_t *config, char **private_key_pem, char **csr_pem)
{
    esp_err_t result = ESP_FAIL;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_pk_context key;
    mbedtls_x509write_csr csr;

    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&ctr_drbg);
    mbedtls_pk_init(&key);
    mbedtls_x509write_csr_init(&csr);

    const char *pers = "esp32-cloud";
    int ret = mbedtls_ctr_drbg_seed(
        &ctr_drbg,
        mbedtls_entropy_func,
        &entropy,
        (const unsigned char *)pers,
        strlen(pers)
    );
    if (ret != 0) {
        ESP_LOGE(TAG, "seed RNG failed: -0x%x", -ret);
        goto cleanup;
    }

    ret = mbedtls_pk_setup(&key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
    if (ret != 0) {
        ESP_LOGE(TAG, "setup EC key failed: -0x%x", -ret);
        goto cleanup;
    }

    ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(key), mbedtls_rng, &ctr_drbg);
    if (ret != 0) {
        ESP_LOGE(TAG, "generate EC key failed: -0x%x", -ret);
        goto cleanup;
    }

    char subject[128];
    snprintf(subject, sizeof(subject), "CN=%s", config->device_id);

    mbedtls_x509write_csr_set_md_alg(&csr, MBEDTLS_MD_SHA256);
    mbedtls_x509write_csr_set_key(&csr, &key);
    ret = mbedtls_x509write_csr_set_subject_name(&csr, subject);
    if (ret != 0) {
        ESP_LOGE(TAG, "set CSR subject failed: -0x%x", -ret);
        goto cleanup;
    }

    char *key_buf = calloc(1, KEY_BUFFER_BYTES);
    char *csr_buf = calloc(1, CSR_BUFFER_BYTES);
    if (key_buf == NULL || csr_buf == NULL) {
        free(key_buf);
        free(csr_buf);
        result = ESP_ERR_NO_MEM;
        goto cleanup;
    }

    ret = mbedtls_pk_write_key_pem(&key, (unsigned char *)key_buf, KEY_BUFFER_BYTES);
    if (ret != 0) {
        ESP_LOGE(TAG, "write private key failed: -0x%x", -ret);
        free(key_buf);
        free(csr_buf);
        goto cleanup;
    }

    ret = mbedtls_x509write_csr_pem(&csr, (unsigned char *)csr_buf, CSR_BUFFER_BYTES, mbedtls_rng, &ctr_drbg);
    if (ret != 0) {
        ESP_LOGE(TAG, "write CSR failed: -0x%x", -ret);
        free(key_buf);
        free(csr_buf);
        goto cleanup;
    }

    *private_key_pem = key_buf;
    *csr_pem = csr_buf;
    result = ESP_OK;

cleanup:
    mbedtls_x509write_csr_free(&csr);
    mbedtls_pk_free(&key);
    mbedtls_ctr_drbg_free(&ctr_drbg);
    mbedtls_entropy_free(&entropy);
    return result;
}

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id != HTTP_EVENT_ON_DATA || evt->data_len <= 0) {
        return ESP_OK;
    }

    http_response_buffer_t *buffer = (http_response_buffer_t *)evt->user_data;
    if (buffer == NULL) {
        return ESP_FAIL;
    }
    if (buffer->len + evt->data_len + 1 > buffer->cap) {
        ESP_LOGE(TAG, "certificate response exceeds %u bytes", HTTP_RESPONSE_LIMIT_BYTES);
        return ESP_FAIL;
    }

    memcpy(buffer->data + buffer->len, evt->data, evt->data_len);
    buffer->len += evt->data_len;
    buffer->data[buffer->len] = '\0';
    return ESP_OK;
}

static char *build_enrollment_url(const helix_cloud_config_t *config)
{
    const char *base = config->api_url;
    const char *path = CONFIG_MQTT_CERTIFICATE_PATH;
    const bool base_has_slash = base[strlen(base) - 1] == '/';
    const bool path_has_slash = path[0] == '/';
    const char *separator = (base_has_slash || path_has_slash) ? "" : "/";

    if (base_has_slash && path_has_slash) {
        path++;
    }

    size_t len = strlen(base) + strlen(separator) + strlen(path) + 1;
    char *url = calloc(1, len);
    if (url == NULL) {
        return NULL;
    }
    snprintf(url, len, "%s%s%s", base, separator, path);
    return url;
}

static esp_err_t enroll_certificate(const helix_cloud_config_t *config, mqtt_cert_bundle_t *bundle)
{
    char *csr_pem = NULL;
    esp_err_t err = generate_key_and_csr(config, &bundle->private_key_pem, &csr_pem);
    if (err != ESP_OK) {
        return err;
    }

    cJSON *request = cJSON_CreateObject();
    cJSON_AddStringToObject(request, "deviceId", config->device_id);
    cJSON_AddStringToObject(request, "csr", csr_pem);
    char *request_body = cJSON_PrintUnformatted(request);
    cJSON_Delete(request);
    free(csr_pem);
    if (request_body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    char *url = build_enrollment_url(config);
    char *auth_header = NULL;
    http_response_buffer_t response = {
        .data = calloc(1, HTTP_RESPONSE_LIMIT_BYTES),
        .len = 0,
        .cap = HTTP_RESPONSE_LIMIT_BYTES,
    };
    if (url == NULL || response.data == NULL) {
        free(url);
        free(request_body);
        free(response.data);
        return ESP_ERR_NO_MEM;
    }

    const char *prefix = "Bearer ";
    size_t auth_len = strlen(prefix) + strlen(config->device_token) + 1;
    auth_header = calloc(1, auth_len);
    if (auth_header == NULL) {
        free(url);
        free(request_body);
        free(response.data);
        return ESP_ERR_NO_MEM;
    }
    snprintf(auth_header, auth_len, "%s%s", prefix, config->device_token);

    esp_http_client_config_t http_config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &response,
        .timeout_ms = HTTP_ENROLLMENT_TIMEOUT_MS,
        .buffer_size = HTTP_BUFFER_BYTES,
        .buffer_size_tx = HTTP_BUFFER_BYTES,
        // Required: without a verification option esp-tls aborts the handshake.
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&http_config);
    if (client == NULL) {
        free(url);
        free(auth_header);
        free(request_body);
        free(response.data);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "Accept-Encoding", "identity");
    esp_http_client_set_header(client, "Connection", "close");
    if (auth_header != NULL) {
        esp_http_client_set_header(client, "Authorization", auth_header);
    }
    esp_http_client_set_post_field(client, request_body, strlen(request_body));

    ESP_LOGI(TAG, "enrolling cloud certificate at %s", url);
    err = esp_http_client_perform(client);
    const int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    free(url);
    free(auth_header);
    free(request_body);

    if (err == ESP_ERR_HTTP_EAGAIN && status >= 200 && status < 300 && response.len > 0) {
        ESP_LOGW(TAG, "certificate enrollment ended with EAGAIN after %u response bytes; parsing response", response.len);
        err = ESP_OK;
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "certificate enrollment HTTP request failed: %s", esp_err_to_name(err));
        free(response.data);
        return err;
    }
    if (status < 200 || status >= 300) {
        ESP_LOGE(TAG, "certificate enrollment failed with HTTP %d: %s", status, response.data);
        free(response.data);
        return ESP_FAIL;
    }

    cJSON *parsed = cJSON_Parse(response.data);
    free(response.data);
    if (parsed == NULL) {
        ESP_LOGE(TAG, "certificate enrollment response is not JSON");
        return ESP_FAIL;
    }

    const cJSON *device_id = cJSON_GetObjectItemCaseSensitive(parsed, "deviceId");
    const cJSON *certificate = cJSON_GetObjectItemCaseSensitive(parsed, "certificate");
    const cJSON *ca = cJSON_GetObjectItemCaseSensitive(parsed, "ca");
    if (cJSON_IsString(device_id) && strcmp(device_id->valuestring, config->device_id) != 0) {
        ESP_LOGE(TAG, "cloud returned certificate for unexpected device %s", device_id->valuestring);
        cJSON_Delete(parsed);
        return ESP_FAIL;
    }
    if (!cJSON_IsString(certificate) || !cJSON_IsString(ca)) {
        ESP_LOGE(TAG, "certificate enrollment response missing certificate or ca");
        cJSON_Delete(parsed);
        return ESP_FAIL;
    }

    bundle->certificate_pem = strdup(certificate->valuestring);
    bundle->root_ca_pem = strdup(ca->valuestring);
    cJSON_Delete(parsed);
    if (bundle->certificate_pem == NULL || bundle->root_ca_pem == NULL) {
        return ESP_ERR_NO_MEM;
    }

    err = persist_bundle_to_nvs(bundle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "persist cloud certificate bundle failed: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "cloud certificate ready and stored in NVS");
    return ESP_OK;
}

void mqtt_cert_bundle_free(mqtt_cert_bundle_t *bundle)
{
    if (bundle == NULL) {
        return;
    }
    free(bundle->private_key_pem);
    free(bundle->certificate_pem);
    free(bundle->root_ca_pem);
    memset(bundle, 0, sizeof(*bundle));
}

esp_err_t mqtt_cert_bundle_clear(void)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open(CERT_NAMESPACE, NVS_READWRITE, &nvs);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_erase_all(nvs);
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return err;
}

esp_err_t mqtt_cert_bundle_load_or_enroll(
    const helix_cloud_config_t *config,
    mqtt_cert_bundle_t *bundle
)
{
    memset(bundle, 0, sizeof(*bundle));

    esp_err_t err = load_bundle_from_nvs(bundle);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "loaded cloud certificate bundle from NVS");
        return ESP_OK;
    }

    ESP_LOGW(TAG, "cloud certificate bundle not available in NVS, enrolling: %s", esp_err_to_name(err));
    mqtt_cert_bundle_free(bundle);
    err = enroll_certificate(config, bundle);
    if (err != ESP_OK) {
        mqtt_cert_bundle_free(bundle);
    }
    return err;
}
