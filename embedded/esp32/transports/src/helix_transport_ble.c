#include "sdkconfig.h"

#if CONFIG_HELIX_TRANSPORT_BLE

#include "helix_transport_ble.h"

#include <stdio.h>
#include <string.h>

#include "esp_bt.h"
#include "esp_log.h"
#include "helix_ble_profile.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#define HELIX_BLE_DEVICE_NAME_PREFIX "Helix ESP32 "
#define HELIX_BLE_MTU_HINT 23

static const char *TAG = "helix_ble_transport";
static uint8_t s_own_addr_type;
static char s_device_name[48];
static char s_info_json[320];

static int gap_event_cb(struct ble_gap_event *event, void *arg);

static void start_advertising(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name = (uint8_t *)s_device_name;
    fields.name_len = strlen(s_device_name);
    fields.name_is_complete = 1;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "BLE adv fields failed rc=%d", rc);
        return;
    }

    struct ble_gap_adv_params params = {0};
    params.conn_mode = BLE_GAP_CONN_MODE_UND;
    params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &params, gap_event_cb, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "BLE advertising failed rc=%d", rc);
        return;
    }
    ESP_LOGI(TAG, "BLE advertising as %s", s_device_name);
}

static int gap_event_cb(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    helix_ble_profile_handle_gap_event(event);
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status != 0) {
            start_advertising();
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        start_advertising();
        break;
    default:
        break;
    }
    return 0;
}

static void on_sync(void)
{
    int rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "BLE address infer failed rc=%d", rc);
        return;
    }
    start_advertising();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "BLE reset reason=%d", reason);
}

static void host_task(void *param)
{
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t helix_ble_transport_start(const helix_ble_transport_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const char *device_id = config->device_id;
    const char *profile_id = config->profile_id;
    if (device_id != NULL && device_id[0] != '\0') {
        snprintf(s_device_name, sizeof(s_device_name), HELIX_BLE_DEVICE_NAME_PREFIX "%.8s", device_id);
        snprintf(
            s_info_json,
            sizeof(s_info_json),
            "{\"deviceId\":\"%s\",\"profileId\":\"%s\",\"serviceUuid\":\"%s\",\"mtuHint\":%d}",
            device_id,
            profile_id != NULL ? profile_id : "",
            HELIX_BLE_SERVICE_UUID,
            HELIX_BLE_MTU_HINT
        );
    } else {
        snprintf(s_device_name, sizeof(s_device_name), HELIX_BLE_DEVICE_NAME_PREFIX "setup");
        snprintf(
            s_info_json,
            sizeof(s_info_json),
            "{\"deviceId\":\"\",\"profileId\":\"\",\"serviceUuid\":\"%s\",\"mtuHint\":%d}",
            HELIX_BLE_SERVICE_UUID,
            HELIX_BLE_MTU_HINT
        );
    }

    helix_ble_profile_config_t profile_config = {
        .info_json = s_info_json,
        .max_command_bytes = config->max_command_bytes,
        .max_notify_bytes = config->max_notify_bytes,
        .on_packet = config->on_packet,
        .user_data = config->user_data,
    };
    esp_err_t ret = helix_ble_profile_init(&profile_config);
    if (ret != ESP_OK) {
        return ret;
    }

    ret = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "classic BT memory release skipped: %s", esp_err_to_name(ret));
    }
    ret = nimble_port_init();
    if (ret != ESP_OK) {
        return ret;
    }

    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_svc_gap_device_name_set(s_device_name);

    const struct ble_gatt_svc_def *services = helix_ble_profile_service_definition();
    int rc = ble_gatts_count_cfg(services);
    if (rc == 0) {
        rc = ble_gatts_add_svcs(services);
    }
    if (rc != 0) {
        return ESP_FAIL;
    }

    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "BLE command transport started");
    return ESP_OK;
}

esp_err_t helix_ble_transport_notify_packet_json(const char *json)
{
    return helix_ble_profile_notify_packet_json(json);
}

const helix_transport_t *helix_ble_transport(void)
{
    return helix_ble_profile_transport();
}

#endif /* CONFIG_HELIX_TRANSPORT_BLE */
