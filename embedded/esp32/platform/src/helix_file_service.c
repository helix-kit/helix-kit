#include "helix_file_service.h"

#include "sdkconfig.h"

#if CONFIG_HELIX_FILE_TRANSFER

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "mbedtls/sha256.h"

#include "helix_binary_channel.h"
#include "helix_storage.h"
#include "helix_xfer_sink.h"
#include "service_dispatcher.h"

static const char *TAG = "helix_file_service";

#define FILE_SERVICE "file"
#define MAX_SESSIONS CONFIG_HELIX_FILE_TRANSFER_MAX_SESSIONS
#define MAX_CHUNK_BYTES 1024  /* matches HELIX_SERIAL_BINARY_MAX_PAYLOAD */
#define SHA_HEX_LEN 64

typedef struct {
    bool active;
    uint16_t id;
    helix_xfer_sink_t *sink;
    mbedtls_sha256_context sha;
    uint32_t received;
    size_t declared_size;
    bool has_expected_sha;
    char expected_sha[SHA_HEX_LEN + 1];
} file_session_t;

static file_session_t s_sessions[MAX_SESSIONS];
static SemaphoreHandle_t s_mutex;
static uint16_t s_next_id = 1;

static void to_hex(const uint8_t *digest, size_t len, char *out)
{
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
        out[i * 2] = hex[digest[i] >> 4];
        out[i * 2 + 1] = hex[digest[i] & 0x0f];
    }
    out[len * 2] = '\0';
}

static file_session_t *find_session(uint16_t id)
{
    for (size_t i = 0; i < MAX_SESSIONS; i++) {
        if (s_sessions[i].active && s_sessions[i].id == id) {
            return &s_sessions[i];
        }
    }
    return NULL;
}

static file_session_t *alloc_session(void)
{
    for (size_t i = 0; i < MAX_SESSIONS; i++) {
        if (!s_sessions[i].active) {
            return &s_sessions[i];
        }
    }
    return NULL;
}

static void release_session(file_session_t *session)
{
    if (session->sink != NULL) {
        session->sink->destroy(session->sink);
    }
    mbedtls_sha256_free(&session->sha);
    memset(session, 0, sizeof(*session));
}

static const char *json_string(const cJSON *payload, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(payload, key);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static bool json_uint(const cJSON *payload, const char *key, uint32_t *out)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(payload, key);
    if (!cJSON_IsNumber(item) || item->valuedouble < 0) {
        return false;
    }
    *out = (uint32_t)item->valuedouble;
    return true;
}

// ---- control-plane handlers -------------------------------------------------

static esp_err_t handle_begin(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    const char *dest = json_string(payload, "dest");
    if (dest == NULL) {
        return service_dispatcher_fail(invocation, "begin requires dest");
    }
    uint32_t size = 0;
    json_uint(payload, "size", &size);
    const char *expected_sha = json_string(payload, "sha256");
    if (expected_sha != NULL && strlen(expected_sha) != SHA_HEX_LEN) {
        return service_dispatcher_fail(invocation, "sha256 must be 64 hex chars");
    }

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    file_session_t *session = alloc_session();
    if (session == NULL) {
        xSemaphoreGive(s_mutex);
        return service_dispatcher_fail(invocation, "no free transfer session");
    }

    esp_err_t err = ESP_OK;
    helix_xfer_sink_t *sink = helix_xfer_sink_open(dest, size, &err);
    if (sink == NULL) {
        xSemaphoreGive(s_mutex);
        return service_dispatcher_fail(invocation, "failed to open destination");
    }

    if (s_next_id == 0) {
        s_next_id = 1;
    }
    session->active = true;
    session->id = s_next_id++;
    session->sink = sink;
    session->received = 0;
    session->declared_size = size;
    session->has_expected_sha = expected_sha != NULL;
    if (expected_sha != NULL) {
        strlcpy(session->expected_sha, expected_sha, sizeof(session->expected_sha));
    }
    mbedtls_sha256_init(&session->sha);
    mbedtls_sha256_starts(&session->sha, 0 /* SHA-256 */);
    const uint16_t id = session->id;
    xSemaphoreGive(s_mutex);

    ESP_LOGI(TAG, "begin session=%u dest=%s size=%u", id, dest, (unsigned)size);

    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "session", id);
    cJSON_AddNumberToObject(reply, "maxChunk", MAX_CHUNK_BYTES);
    cJSON_AddNumberToObject(reply, "resumeOffset", 0);
    return service_dispatcher_respond(invocation, "file-begin", reply);
}

static esp_err_t handle_commit(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    uint32_t id = 0;
    if (!json_uint(payload, "session", &id)) {
        return service_dispatcher_fail(invocation, "commit requires session");
    }
    const char *override_sha = json_string(payload, "sha256");

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    file_session_t *session = find_session((uint16_t)id);
    if (session == NULL) {
        xSemaphoreGive(s_mutex);
        return service_dispatcher_fail(invocation, "unknown session");
    }

    uint8_t digest[32];
    mbedtls_sha256_finish(&session->sha, digest);
    char computed[SHA_HEX_LEN + 1];
    to_hex(digest, sizeof(digest), computed);

    const uint32_t received = session->received;
    const char *expected = override_sha != NULL ? override_sha
                          : (session->has_expected_sha ? session->expected_sha : NULL);

    const char *failure = NULL;
    if (session->declared_size > 0 && received != session->declared_size) {
        failure = "size mismatch";
    } else if (expected != NULL && strcasecmp(expected, computed) != 0) {
        failure = "sha256 mismatch";
    }

    if (failure != NULL) {
        session->sink->abort(session->sink);
        release_session(session);
        xSemaphoreGive(s_mutex);
        ESP_LOGW(TAG, "commit session=%u failed: %s", (unsigned)id, failure);
        return service_dispatcher_fail(invocation, failure);
    }

    esp_err_t err = session->sink->commit(session->sink);
    if (err != ESP_OK) {
        session->sink->abort(session->sink);
        release_session(session);
        xSemaphoreGive(s_mutex);
        return service_dispatcher_fail(invocation, "commit failed");
    }
    release_session(session);
    xSemaphoreGive(s_mutex);

    ESP_LOGI(TAG, "commit session=%u ok size=%u sha=%s", (unsigned)id, (unsigned)received, computed);

    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "session", id);
    cJSON_AddBoolToObject(reply, "ok", true);
    cJSON_AddNumberToObject(reply, "size", received);
    cJSON_AddStringToObject(reply, "sha256", computed);
    return service_dispatcher_respond(invocation, "file-commit", reply);
}

static esp_err_t handle_abort(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    uint32_t id = 0;
    if (!json_uint(payload, "session", &id)) {
        return service_dispatcher_fail(invocation, "abort requires session");
    }
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    file_session_t *session = find_session((uint16_t)id);
    if (session != NULL) {
        session->sink->abort(session->sink);
        release_session(session);
    }
    xSemaphoreGive(s_mutex);

    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "session", id);
    return service_dispatcher_respond(invocation, "file-abort", reply);
}

// Read a stored FAT file back and report size + sha256 so a host can verify a
// completed transfer without extracting the flash image. `fs:` scheme only.
static esp_err_t handle_stat(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    const char *dest = json_string(payload, "dest");
    if (dest == NULL || strncmp(dest, "fs:", 3) != 0) {
        return service_dispatcher_fail(invocation, "stat requires an fs: dest");
    }
    const char *mount = helix_storage_mount_point();
    if (mount == NULL) {
        return service_dispatcher_fail(invocation, "storage not mounted");
    }
    const char *rel = dest + 3;
    while (*rel == '/') {
        rel++;
    }
    char path[256];
    if (snprintf(path, sizeof(path), "%s/%s", mount, rel) >= (int)sizeof(path)) {
        return service_dispatcher_fail(invocation, "path too long");
    }

    cJSON *reply = cJSON_CreateObject();
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        cJSON_AddBoolToObject(reply, "exists", false);
        return service_dispatcher_respond(invocation, "file-stat", reply);
    }

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    uint8_t buf[512];
    size_t total = 0;
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), fp)) > 0) {
        mbedtls_sha256_update(&sha, buf, n);
        total += n;
    }
    fclose(fp);
    uint8_t digest[32];
    mbedtls_sha256_finish(&sha, digest);
    mbedtls_sha256_free(&sha);
    char hex[SHA_HEX_LEN + 1];
    to_hex(digest, sizeof(digest), hex);

    cJSON_AddBoolToObject(reply, "exists", true);
    cJSON_AddNumberToObject(reply, "size", (double)total);
    cJSON_AddStringToObject(reply, "sha256", hex);
    return service_dispatcher_respond(invocation, "file-stat", reply);
}

static esp_err_t file_service_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (strcmp(method, "begin") == 0) {
        return handle_begin(invocation, payload);
    }
    if (strcmp(method, "chunk-commit") == 0 || strcmp(method, "commit") == 0) {
        return handle_commit(invocation, payload);
    }
    if (strcmp(method, "abort") == 0) {
        return handle_abort(invocation, payload);
    }
    if (strcmp(method, "stat") == 0) {
        return handle_stat(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unknown file method");
}

// ---- data plane -------------------------------------------------------------

static esp_err_t file_service_ingest_chunk(
    uint16_t session_id,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source,
    void *user_data
)
{
    (void)source;
    (void)user_data;

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    file_session_t *session = find_session(session_id);
    if (session == NULL) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_ARG;
    }
    if (offset != session->received) {
        ESP_LOGW(TAG, "session=%u out-of-order chunk (got offset=%u expected=%u)",
                 session_id, (unsigned)offset, (unsigned)session->received);
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = session->sink->write(session->sink, offset, data, len);
    if (err == ESP_OK) {
        mbedtls_sha256_update(&session->sha, data, len);
        session->received += (uint32_t)len;
    }
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t helix_file_service_start(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    esp_err_t err = service_dispatcher_register(FILE_SERVICE, file_service_handle_command);
    if (err != ESP_OK) {
        return err;
    }
    err = helix_binary_channel_register(file_service_ingest_chunk, NULL);
    if (err != ESP_OK) {
        return err;
    }
    ESP_LOGI(TAG, "file-transfer service started (max sessions=%d, max chunk=%d)",
             MAX_SESSIONS, MAX_CHUNK_BYTES);
    return ESP_OK;
}

#else /* !CONFIG_HELIX_FILE_TRANSFER */

esp_err_t helix_file_service_start(void)
{
    return ESP_OK;
}

#endif /* CONFIG_HELIX_FILE_TRANSFER */
