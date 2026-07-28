#include "health.h"

#include "cJSON.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "helix_event.h"

#define HELIX_HEALTH_SERVICE "health"
#define HELIX_HEALTH_EVENT_TYPE "heartbeat"
#define US_PER_SECOND 1000000
#define MS_PER_SECOND 1000

static const char *TAG = "health";

static helix_cloud_config_t s_config;

static cJSON *build_health_payload(void)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON *network = cJSON_CreateObject();
    if (payload == NULL || network == NULL) {
        cJSON_Delete(payload);
        cJSON_Delete(network);
        return NULL;
    }

    cJSON_AddStringToObject(payload, "deviceId", s_config.device_id);
    cJSON_AddStringToObject(payload, "firmwareVersion", CONFIG_DEVICE_FIRMWARE_VERSION);
    cJSON_AddNumberToObject(payload, "uptimeSeconds", esp_timer_get_time() / US_PER_SECOND);
    cJSON_AddNumberToObject(payload, "freeHeapBytes", esp_get_free_heap_size());
    cJSON_AddStringToObject(payload, "platform", "esp32");
    cJSON_AddItemToObject(network, "rssiDbm", cJSON_CreateNull());
    cJSON_AddItemToObject(payload, "network", network);
    return payload;
}

static void publish_health(void)
{
    cJSON *payload = build_health_payload();
    if (payload == NULL) {
        ESP_LOGE(TAG, "failed to allocate health payload");
        return;
    }

    int msg_id = 0;
    esp_err_t err = helix_event_publish(HELIX_HEALTH_SERVICE, HELIX_HEALTH_EVENT_TYPE, payload, &msg_id);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "health event publish failed: %s", esp_err_to_name(err));
    }
}

static void health_task(void *arg)
{
    (void)arg;
    const TickType_t delay = pdMS_TO_TICKS(CONFIG_HEARTBEAT_INTERVAL_SEC * MS_PER_SECOND);
    while (true) {
        publish_health();
        vTaskDelay(delay);
    }
}

esp_err_t health_start(const helix_cloud_config_t *config)
{
#if !CONFIG_HELIX_TRANSPORT_MQTT
    (void)config;
    ESP_LOGW(TAG, "health telemetry disabled (MQTT transport off)");
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    s_config = *config;
    publish_health();
    BaseType_t created = xTaskCreate(health_task, "health", 4096, NULL, 5, NULL);
    return created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
#endif /* CONFIG_HELIX_TRANSPORT_MQTT */
}
