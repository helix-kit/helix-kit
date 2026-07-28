#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_transport.h"

typedef struct {
    const char *device_id;
    const char *broker_host;
    uint16_t broker_port;
    bool use_tls;
    const char *server_common_name;
    const char *root_ca_pem;
    const char *client_cert_pem;
    const char *client_key_pem;
    int keepalive_seconds;
    helix_transport_packet_handler_t on_packet;
    void *user_data;
} helix_mqtt_transport_config_t;

esp_err_t helix_mqtt_transport_start(const helix_mqtt_transport_config_t *config);
esp_err_t helix_mqtt_transport_validate_connection(
    const helix_mqtt_transport_config_t *config,
    int timeout_ms
);
esp_err_t helix_mqtt_transport_publish_packet_json(const char *json, int *msg_id);
esp_err_t helix_mqtt_transport_publish_event_json(const char *service, const char *json, int *msg_id);
bool helix_mqtt_transport_is_started(void);

// True while the MQTT client is connected to the broker (set on
// MQTT_EVENT_CONNECTED, cleared on disconnect/error). Distinct from
// _is_started(), which only means the client object exists.
bool helix_mqtt_transport_is_online(void);

// Callback invoked (on the MQTT client task) when a QoS-1 publish is acked by
// the broker (MQTT_EVENT_PUBLISHED), with the msg_id returned by the publish
// call. Used by the event queue to mark stored events delivered. Keep it brief.
typedef void (*helix_mqtt_publish_ack_cb_t)(int msg_id, void *user_data);
void helix_mqtt_transport_set_publish_callback(helix_mqtt_publish_ack_cb_t cb, void *user_data);

const helix_transport_t *helix_mqtt_transport(void);
