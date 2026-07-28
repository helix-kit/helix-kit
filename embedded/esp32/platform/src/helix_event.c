#include "helix_event.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>

#include "esp_random.h"
#include "sdkconfig.h"
#include "time_sync.h"

#include "helix_event_queue.h"

#if CONFIG_HELIX_TRANSPORT_MQTT
#include "helix_transport_mqtt.h"
#endif

#define HELIX_EVENT_ISO_TIME_BYTES 32
#define HELIX_EVENT_MSG_ID_BYTES 160

static uint32_t s_event_counter;

esp_err_t helix_event_publish(const char *service, const char *type, cJSON *payload, int *out_msg_id)
{
    if (service == NULL || service[0] == '\0' || type == NULL || type[0] == '\0') {
        cJSON_Delete(payload);
        return ESP_ERR_INVALID_ARG;
    }

#if CONFIG_HELIX_EVENT_QUEUE
    // Durable path: persist first; the queue owns delivery, so no msg_id yet.
    if (out_msg_id != NULL) {
        *out_msg_id = 0;
    }
    return helix_event_queue_enqueue(service, type, payload, 0, NULL, NULL, 0);
#elif !CONFIG_HELIX_TRANSPORT_MQTT
    (void)out_msg_id;
    cJSON_Delete(payload);
    return ESP_ERR_NOT_SUPPORTED;
#else
    char timestamp[HELIX_EVENT_ISO_TIME_BYTES];
    time_format_utc(timestamp, sizeof(timestamp));

    char msg_id[HELIX_EVENT_MSG_ID_BYTES];
    snprintf(
        msg_id,
        sizeof(msg_id),
        "%s-%s-%" PRIu32 "-%08" PRIx32,
        service,
        timestamp,
        ++s_event_counter,
        esp_random()
    );

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        cJSON_Delete(payload);
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(root, "type", type);
    cJSON_AddStringToObject(root, "msgId", msg_id);
    cJSON_AddStringToObject(root, "timestamp", timestamp);
    cJSON_AddItemToObject(root, "payload", payload != NULL ? payload : cJSON_CreateObject());

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = helix_mqtt_transport_publish_event_json(service, json, out_msg_id);
    free(json);
    return err;
#endif /* CONFIG_HELIX_TRANSPORT_MQTT */
}
