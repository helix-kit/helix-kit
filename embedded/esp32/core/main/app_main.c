#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "app_selection.h"
#include "certificates.h"
#include "cloud.h"
#include "health.h"
#include "helix_db.h"
#include "helix_db_service.h"
#include "helix_event_queue.h"
#include "helix_events_service.h"
#include "helix_file_service.h"
#include "helix_ota.h"
#include "helix_platform.h"
#include "helix_storage.h"
#include "helix_provisioning.h"
#include "helix_service_endpoint.h"
#include "helix_transport_ble.h"
#include "helix_transport_mqtt.h"
#include "helix_transport_serial.h"
#include "helix_transport_websocket.h"
#include "time_sync.h"
#include "wifi.h"

static const char *TAG = "main";

#if CONFIG_HELIX_TRANSPORT_BLE
static esp_err_t start_ble_transport(const helix_cloud_config_t *config)
{
    helix_ble_transport_config_t ble_config = {
        .device_id = config != NULL ? config->device_id : NULL,
        .profile_id = config != NULL ? config->profile_id : NULL,
        .on_packet = helix_service_endpoint_receive,
    };
    esp_err_t err = helix_service_endpoint_attach_transport(helix_ble_transport());
    if (err == ESP_OK) {
        err = helix_ble_transport_start(&ble_config);
    }
    return err;
}
#endif /* CONFIG_HELIX_TRANSPORT_BLE */

#if CONFIG_HELIX_TRANSPORT_SERIAL
static esp_err_t start_serial_transport(void)
{
    helix_serial_transport_config_t serial_config = {
        .uart_num = UART_NUM_0,
        .on_packet = helix_service_endpoint_receive,
#if CONFIG_HELIX_FILE_TRANSFER
        // Binary chunks are written to the FAT sink on this task; FATFS needs
        // more stack than the default JSON-only path, and a deeper UART RX FIFO
        // absorbs bursts of binary data frames before the task drains them.
        .task_stack_bytes = 16384,
        .uart_buffer_bytes = 8192,
#endif
    };
    esp_err_t err = helix_service_endpoint_attach_transport(helix_serial_transport());
    if (err == ESP_OK) {
        err = helix_serial_transport_start(&serial_config);
    }
    return err;
}
#endif /* CONFIG_HELIX_TRANSPORT_SERIAL */

#if CONFIG_HELIX_TRANSPORT_WEBSOCKET
static esp_err_t start_websocket_transport(void)
{
    helix_websocket_transport_config_t websocket_config = {
        .on_packet = helix_service_endpoint_receive,
    };
    esp_err_t err = helix_service_endpoint_attach_transport(helix_websocket_transport());
    if (err == ESP_OK) {
        err = helix_websocket_transport_start(&websocket_config);
    }
    return err;
}
#endif /* CONFIG_HELIX_TRANSPORT_WEBSOCKET */

void app_main(void)
{
    ESP_LOGI(TAG, "ESP32 Firmware starting");
    ESP_LOGI(TAG, "firmware=%s", CONFIG_DEVICE_FIRMWARE_VERSION);

    ESP_ERROR_CHECK(helix_platform_init());
    ESP_ERROR_CHECK(helix_service_endpoint_init());

    // Mount on-device storage and start the transport-agnostic file-transfer
    // service before transports come up so early transfers have a sink. Both
    // are graceful no-ops when their Kconfig features are disabled, and a
    // missing storage partition only logs a warning.
    (void)helix_storage_mount();
    ESP_ERROR_CHECK(helix_file_service_start());
    if (helix_db_init() != ESP_OK) {
        ESP_LOGW(TAG, "on-device database unavailable");
    } else {
        (void)helix_db_service_start();
    }
    if (helix_event_queue_init() == ESP_OK) {
        (void)helix_events_service_start();
    }

    ESP_ERROR_CHECK(wifi_register_provisioning_domain());
    ESP_ERROR_CHECK(cloud_register_provisioning_domain());
    ESP_ERROR_CHECK(helix_provisioning_start());
    ESP_ERROR_CHECK(helix_ota_start());
    ESP_ERROR_CHECK(app_selection_start());

    helix_wifi_config_t wifi_config = {0};
    helix_cloud_config_t cloud_config = {0};
    const bool has_wifi_config = wifi_config_load(&wifi_config) == ESP_OK;
    const bool has_cloud_config = cloud_config_load(&cloud_config) == ESP_OK;

    esp_err_t err = ESP_OK;

#if CONFIG_HELIX_TRANSPORT_BLE
    err = start_ble_transport(has_cloud_config ? &cloud_config : NULL);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "BLE command transport unavailable: %s", esp_err_to_name(err));
    }
#endif

#if CONFIG_HELIX_TRANSPORT_SERIAL
    err = start_serial_transport();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "serial command transport unavailable: %s", esp_err_to_name(err));
    }
#endif

    if (!has_wifi_config) {
        ESP_LOGW(TAG, "Wi-Fi config missing; Wi-Fi, MQTT, and cloud services are deferred");
        helix_platform_wait_forever();
    }

    err = wifi_connect(&wifi_config);
    if (err != ESP_OK) {
        helix_platform_stop_on_error("network connect", err);
    }

#if CONFIG_HELIX_TRANSPORT_WEBSOCKET
    err = start_websocket_transport();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "WebSocket command transport unavailable: %s", esp_err_to_name(err));
    }
#endif

    time_sync();

#if CONFIG_HELIX_TRANSPORT_MQTT
    if (!has_cloud_config) {
        ESP_LOGW(TAG, "cloud config missing; MQTT and health services are deferred");
        helix_platform_wait_forever();
    }

    mqtt_cert_bundle_t mqtt_cert_bundle = {0};
    err = cloud_start_mqtt(&cloud_config, &mqtt_cert_bundle);
    if (err != ESP_OK) {
        helix_platform_stop_on_error("MQTT start", err);
    }

    err = health_start(&cloud_config);
    if (err != ESP_OK) {
        helix_platform_stop_on_error("health service start", err);
    }
#endif

    (void)err;
    (void)has_cloud_config;
    (void)cloud_config;
    helix_platform_wait_forever();
}
