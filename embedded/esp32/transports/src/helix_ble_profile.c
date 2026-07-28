#include "sdkconfig.h"

#if CONFIG_HELIX_TRANSPORT_BLE

#include "helix_ble_profile.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "os/os_mbuf.h"

static const char *TAG = "helix_ble_profile";

static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static bool s_response_notify_enabled;
static uint16_t s_response_attr_handle;
static uint16_t s_info_attr_handle;
static helix_ble_profile_config_t s_config;

static esp_err_t profile_send_packet_json(const char *json, void *context)
{
    (void)context;
    return helix_ble_profile_notify_packet_json(json);
}

static const helix_transport_t s_transport = {
    .name = "BLE",
    .send_packet_json = profile_send_packet_json,
};

static const ble_uuid128_t s_service_uuid =
    BLE_UUID128_INIT(0x01, 0x00, 0x3d, 0x7c, 0x8f, 0x4a, 0x3b, 0x9f, 0xaa, 0x4e, 0x42, 0x0f, 0xa0, 0xb6, 0x64, 0x8f);
static const ble_uuid128_t s_command_uuid =
    BLE_UUID128_INIT(0x02, 0x00, 0x3d, 0x7c, 0x8f, 0x4a, 0x3b, 0x9f, 0xaa, 0x4e, 0x42, 0x0f, 0xa0, 0xb6, 0x64, 0x8f);
static const ble_uuid128_t s_response_uuid =
    BLE_UUID128_INIT(0x03, 0x00, 0x3d, 0x7c, 0x8f, 0x4a, 0x3b, 0x9f, 0xaa, 0x4e, 0x42, 0x0f, 0xa0, 0xb6, 0x64, 0x8f);
static const ble_uuid128_t s_info_uuid =
    BLE_UUID128_INIT(0x04, 0x00, 0x3d, 0x7c, 0x8f, 0x4a, 0x3b, 0x9f, 0xaa, 0x4e, 0x42, 0x0f, 0xa0, 0xb6, 0x64, 0x8f);

static int append_mbuf_flat(const struct os_mbuf *om, char *out, size_t out_len, uint16_t *out_payload_len)
{
    uint16_t payload_len = OS_MBUF_PKTLEN(om);
    if (payload_len == 0 || payload_len >= out_len) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    int rc = ble_hs_mbuf_to_flat(om, out, out_len - 1, out_payload_len);
    if (rc != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    out[*out_payload_len] = '\0';
    return 0;
}

esp_err_t helix_ble_profile_notify_packet_json(const char *json)
{
    if (!s_response_notify_enabled || s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return ESP_ERR_INVALID_STATE;
    }
    if (json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    size_t len = strlen(json);
    size_t max_bytes = s_config.max_notify_bytes > 0
        ? s_config.max_notify_bytes
        : HELIX_BLE_DEFAULT_NOTIFY_MAX_BYTES;
    if (len > max_bytes) {
        len = max_bytes;
    }
    struct os_mbuf *om = ble_hs_mbuf_from_flat(json, len);
    if (om == NULL) {
        return ESP_ERR_NO_MEM;
    }
    int rc = ble_gatts_notify_custom(s_conn_handle, s_response_attr_handle, om);
    return rc == 0 ? ESP_OK : ESP_FAIL;
}

static int handle_command_write(struct ble_gatt_access_ctxt *ctxt)
{
    size_t max_bytes = s_config.max_command_bytes > 0
        ? s_config.max_command_bytes
        : HELIX_BLE_DEFAULT_COMMAND_MAX_BYTES;
    char *payload = calloc(1, max_bytes);
    if (payload == NULL) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    uint16_t payload_len = 0;
    int rc = append_mbuf_flat(ctxt->om, payload, max_bytes, &payload_len);
    if (rc != 0) {
        free(payload);
        return rc;
    }

    helix_protocol_packet_t packet = {0};
    esp_err_t err = helix_protocol_parse_packet(payload, payload_len, &packet);
    free(payload);
    if (err != ESP_OK) {
        helix_ble_profile_notify_packet_json(
            "{\"message\":{\"service\":\"ble\",\"method\":\"ble-error\",\"payload\":{\"error\":\"invalid Helix packet\"}}}"
        );
        return 0;
    }

    if (s_config.on_packet != NULL) {
        err = s_config.on_packet(&packet, &s_transport, s_config.user_data);
        if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
            ESP_LOGW(TAG, "BLE packet handler failed: %s", esp_err_to_name(err));
        }
    }
    helix_protocol_packet_free(&packet);
    return 0;
}

static int gatt_access_cb(
    uint16_t conn_handle,
    uint16_t attr_handle,
    struct ble_gatt_access_ctxt *ctxt,
    void *arg
)
{
    (void)conn_handle;
    (void)arg;
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return handle_command_write(ctxt);
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR && attr_handle == s_info_attr_handle) {
        const char *info_json = s_config.info_json != NULL ? s_config.info_json : "{}";
        int rc = os_mbuf_append(ctxt->om, info_json, strlen(info_json));
        return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return 0;
}

static const struct ble_gatt_svc_def s_gatt_services[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_service_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &s_command_uuid.u,
                .access_cb = gatt_access_cb,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid = &s_response_uuid.u,
                .access_cb = gatt_access_cb,
                .flags = BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_READ,
                .val_handle = &s_response_attr_handle,
            },
            {
                .uuid = &s_info_uuid.u,
                .access_cb = gatt_access_cb,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &s_info_attr_handle,
            },
            {0},
        },
    },
    {0},
};

esp_err_t helix_ble_profile_init(const helix_ble_profile_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    s_config = *config;
    s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
    s_response_notify_enabled = false;
    return ESP_OK;
}

const struct ble_gatt_svc_def *helix_ble_profile_service_definition(void)
{
    return s_gatt_services;
}

int helix_ble_profile_handle_gap_event(struct ble_gap_event *event)
{
    if (event == NULL) {
        return BLE_HS_EINVAL;
    }
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "BLE connected conn=%u", s_conn_handle);
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_response_notify_enabled = false;
        ESP_LOGI(TAG, "BLE disconnected");
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_response_attr_handle) {
            s_response_notify_enabled = event->subscribe.cur_notify;
            s_conn_handle = event->subscribe.conn_handle;
            ESP_LOGI(TAG, "BLE response notifications %s", s_response_notify_enabled ? "enabled" : "disabled");
        }
        break;
    default:
        break;
    }
    return 0;
}

const helix_transport_t *helix_ble_profile_transport(void)
{
    return &s_transport;
}

#endif /* CONFIG_HELIX_TRANSPORT_BLE */
