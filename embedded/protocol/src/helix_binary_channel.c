#include "helix_binary_channel.h"

#include <stddef.h>

#include "esp_log.h"

static const char *TAG = "helix_binary_channel";

static helix_binary_ingest_fn s_ingest;
static void *s_user_data;

esp_err_t helix_binary_channel_register(helix_binary_ingest_fn fn, void *user_data)
{
    s_ingest = fn;
    s_user_data = user_data;
    if (fn != NULL) {
        ESP_LOGI(TAG, "binary channel consumer registered");
    }
    return ESP_OK;
}

esp_err_t helix_binary_channel_ingest(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source
)
{
    helix_binary_ingest_fn fn = s_ingest;
    if (fn == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    return fn(session, offset, data, len, source, s_user_data);
}

bool helix_binary_channel_supported(const helix_transport_t *transport)
{
    return transport != NULL && transport->send_binary != NULL;
}

esp_err_t helix_binary_channel_send(
    const helix_transport_t *transport,
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len
)
{
    if (data == NULL && len > 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!helix_binary_channel_supported(transport)) {
        return ESP_ERR_NOT_SUPPORTED;
    }
    return transport->send_binary(session, offset, data, len, transport->context);
}
