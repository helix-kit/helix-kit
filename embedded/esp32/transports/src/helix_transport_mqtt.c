#include "sdkconfig.h"

#if CONFIG_HELIX_TRANSPORT_MQTT

#include "helix_transport_mqtt.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "mqtt_client.h"

#define HELIX_MQTT_URI_BUFFER_BYTES 160
#define HELIX_MQTT_TOPIC_BUFFER_BYTES 160
#define HELIX_MQTT_DEVICE_ID_BUFFER_BYTES 96
#define HELIX_MQTT_VALIDATE_CONNECTED_BIT BIT0
#define HELIX_MQTT_VALIDATE_FAILED_BIT BIT1
#define HELIX_MQTT_VALIDATE_TIMEOUT_MS 15000

static const char *TAG = "helix_mqtt_transport";

static esp_mqtt_client_handle_t s_client;
static volatile bool s_online;
static helix_mqtt_publish_ack_cb_t s_publish_cb;
static void *s_publish_cb_ctx;
static helix_mqtt_transport_config_t s_config;
static char s_uri[HELIX_MQTT_URI_BUFFER_BYTES];
static char s_command_topic[HELIX_MQTT_TOPIC_BUFFER_BYTES];
static char s_response_topic[HELIX_MQTT_TOPIC_BUFFER_BYTES];
static char s_device_id[HELIX_MQTT_DEVICE_ID_BUFFER_BYTES];

typedef struct {
    EventGroupHandle_t event_group;
} mqtt_validate_context_t;

static esp_err_t mqtt_send_packet_json(const char *json, void *context)
{
    (void)context;
    return helix_mqtt_transport_publish_packet_json(json, NULL);
}

static const helix_transport_t s_transport = {
    .name = "MQTT",
    .send_packet_json = mqtt_send_packet_json,
};

static esp_err_t validate_config(const helix_mqtt_transport_config_t *config)
{
    if (config == NULL || config->device_id == NULL || config->device_id[0] == '\0' ||
        config->broker_host == NULL || config->broker_host[0] == '\0' || config->broker_port == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (config->use_tls &&
        (config->root_ca_pem == NULL || config->client_cert_pem == NULL || config->client_key_pem == NULL)) {
        return ESP_ERR_INVALID_ARG;
    }
    return ESP_OK;
}

static esp_err_t build_uri(char *out, size_t out_len, const helix_mqtt_transport_config_t *config)
{
    int written = snprintf(
        out,
        out_len,
        "%s://%s:%u",
        config->use_tls ? "mqtts" : "mqtt",
        config->broker_host,
        config->broker_port
    );
    return written > 0 && (size_t)written < out_len ? ESP_OK : ESP_ERR_INVALID_SIZE;
}

static esp_err_t build_topics(const char *device_id)
{
    int in_written = snprintf(s_command_topic, sizeof(s_command_topic), "helix/device/%s/in", device_id);
    int out_written = snprintf(s_response_topic, sizeof(s_response_topic), "helix/device/%s/out", device_id);
    int id_written = snprintf(s_device_id, sizeof(s_device_id), "%s", device_id);
    if (in_written <= 0 || out_written <= 0 || id_written <= 0 ||
        (size_t)in_written >= sizeof(s_command_topic) ||
        (size_t)out_written >= sizeof(s_response_topic) ||
        (size_t)id_written >= sizeof(s_device_id)) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
        ESP_LOGI(TAG, "MQTT connected");
        s_online = true;
        if (s_command_topic[0] != '\0') {
            int msg_id = esp_mqtt_client_subscribe(s_client, s_command_topic, 1);
            if (msg_id < 0) {
                ESP_LOGE(TAG, "MQTT command subscribe failed topic=%s", s_command_topic);
            } else {
                ESP_LOGI(TAG, "MQTT command subscribe requested msg_id=%d topic=%s", msg_id, s_command_topic);
            }
        }
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "MQTT disconnected");
        s_online = false;
        break;
    case MQTT_EVENT_DATA:
        if (event->data != NULL && s_config.on_packet != NULL) {
            helix_protocol_packet_t packet = {0};
            esp_err_t err = helix_protocol_parse_packet(event->data, event->data_len, &packet);
            if (err == ESP_OK) {
                err = s_config.on_packet(&packet, &s_transport, s_config.user_data);
                helix_protocol_packet_free(&packet);
            }
            if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
                ESP_LOGW(TAG, "MQTT packet handler failed: %s", esp_err_to_name(err));
            }
        }
        break;
    case MQTT_EVENT_PUBLISHED:
        ESP_LOGI(TAG, "MQTT publish acknowledged msg_id=%d", event->msg_id);
        if (s_publish_cb != NULL) {
            s_publish_cb(event->msg_id, s_publish_cb_ctx);
        }
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGE(TAG, "MQTT error");
        if (event->error_handle != NULL) {
            ESP_LOGE(TAG, "esp-tls err=0x%x tls_stack=0x%x sock_errno=%d",
                     event->error_handle->esp_tls_last_esp_err,
                     event->error_handle->esp_tls_stack_err,
                     event->error_handle->esp_transport_sock_errno);
        }
        break;
    default:
        break;
    }
}

esp_err_t helix_mqtt_transport_start(const helix_mqtt_transport_config_t *config)
{
    esp_err_t err = validate_config(config);
    if (err != ESP_OK) {
        return err;
    }
    if (s_client != NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    s_config = *config;
    err = build_uri(s_uri, sizeof(s_uri), config);
    if (err == ESP_OK) {
        err = build_topics(config->device_id);
    }
    if (err != ESP_OK) {
        return err;
    }

    esp_mqtt_client_config_t mqtt_cfg = {0};
    mqtt_cfg.broker.address.uri = s_uri;
    mqtt_cfg.credentials.client_id = config->device_id;
    mqtt_cfg.session.keepalive = config->keepalive_seconds > 0 ? config->keepalive_seconds : 30;
    if (config->root_ca_pem != NULL) {
        mqtt_cfg.broker.verification.certificate = config->root_ca_pem;
    }
    if (config->server_common_name != NULL && config->server_common_name[0] != '\0') {
        mqtt_cfg.broker.verification.common_name = config->server_common_name;
    }
    if (config->client_cert_pem != NULL) {
        mqtt_cfg.credentials.authentication.certificate = config->client_cert_pem;
    }
    if (config->client_key_pem != NULL) {
        mqtt_cfg.credentials.authentication.key = config->client_key_pem;
    }

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (s_client == NULL) {
        return ESP_FAIL;
    }

    err = esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    if (err != ESP_OK) {
        return err;
    }

    ESP_LOGI(TAG, "connecting to %s as %s", s_uri, config->device_id);
    return esp_mqtt_client_start(s_client);
}

static esp_err_t publish_to_topic(const char *topic, const char *json, int *msg_id)
{
    if (s_client == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (topic == NULL || topic[0] == '\0' || json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int published_msg_id = esp_mqtt_client_publish(s_client, topic, json, 0, 1, 0);
    if (published_msg_id < 0) {
        return ESP_FAIL;
    }
    if (msg_id != NULL) {
        *msg_id = published_msg_id;
    }
    ESP_LOGI(TAG, "published msg_id=%d topic=%s", published_msg_id, topic);
    return ESP_OK;
}

esp_err_t helix_mqtt_transport_publish_packet_json(const char *json, int *msg_id)
{
    return publish_to_topic(s_response_topic, json, msg_id);
}

esp_err_t helix_mqtt_transport_publish_event_json(const char *service, const char *json, int *msg_id)
{
    if (service == NULL || service[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    char topic[HELIX_MQTT_TOPIC_BUFFER_BYTES];
    int written = snprintf(topic, sizeof(topic), "helix/device/%s/service/%s/event", s_device_id, service);
    if (written <= 0 || (size_t)written >= sizeof(topic)) {
        return ESP_ERR_INVALID_SIZE;
    }
    return publish_to_topic(topic, json, msg_id);
}

bool helix_mqtt_transport_is_started(void)
{
    return s_client != NULL;
}

bool helix_mqtt_transport_is_online(void)
{
    return s_online;
}

void helix_mqtt_transport_set_publish_callback(helix_mqtt_publish_ack_cb_t cb, void *user_data)
{
    s_publish_cb = cb;
    s_publish_cb_ctx = user_data;
}

const helix_transport_t *helix_mqtt_transport(void)
{
    return &s_transport;
}

static void mqtt_validate_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)base;
    (void)event_data;
    mqtt_validate_context_t *context = handler_args;
    if (context == NULL || context->event_group == NULL) {
        return;
    }
    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
        xEventGroupSetBits(context->event_group, HELIX_MQTT_VALIDATE_CONNECTED_BIT);
        break;
    case MQTT_EVENT_DISCONNECTED:
    case MQTT_EVENT_ERROR:
        xEventGroupSetBits(context->event_group, HELIX_MQTT_VALIDATE_FAILED_BIT);
        break;
    default:
        break;
    }
}

esp_err_t helix_mqtt_transport_validate_connection(
    const helix_mqtt_transport_config_t *config,
    int timeout_ms
)
{
    esp_err_t err = validate_config(config);
    if (err != ESP_OK) {
        return err;
    }
    char uri[HELIX_MQTT_URI_BUFFER_BYTES];
    err = build_uri(uri, sizeof(uri), config);
    if (err != ESP_OK) {
        return err;
    }

    const int effective_timeout_ms = timeout_ms > 0 ? timeout_ms : HELIX_MQTT_VALIDATE_TIMEOUT_MS;
    mqtt_validate_context_t context = {.event_group = xEventGroupCreate()};
    if (context.event_group == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_mqtt_client_config_t mqtt_cfg = {0};
    mqtt_cfg.broker.address.uri = uri;
    mqtt_cfg.credentials.client_id = config->device_id;
    mqtt_cfg.session.keepalive = config->keepalive_seconds > 0 ? config->keepalive_seconds : 10;
    mqtt_cfg.network.timeout_ms = effective_timeout_ms;
    if (config->use_tls) {
        mqtt_cfg.broker.verification.certificate = config->root_ca_pem;
        mqtt_cfg.broker.verification.common_name = config->server_common_name;
        mqtt_cfg.credentials.authentication.certificate = config->client_cert_pem;
        mqtt_cfg.credentials.authentication.key = config->client_key_pem;
    }

    esp_mqtt_client_handle_t client = esp_mqtt_client_init(&mqtt_cfg);
    if (client == NULL) {
        vEventGroupDelete(context.event_group);
        return ESP_FAIL;
    }
    err = esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, mqtt_validate_event_handler, &context);
    if (err == ESP_OK) {
        err = esp_mqtt_client_start(client);
    }
    if (err == ESP_OK) {
        EventBits_t bits = xEventGroupWaitBits(
            context.event_group,
            HELIX_MQTT_VALIDATE_CONNECTED_BIT | HELIX_MQTT_VALIDATE_FAILED_BIT,
            pdFALSE,
            pdFALSE,
            pdMS_TO_TICKS(effective_timeout_ms)
        );
        err = (bits & HELIX_MQTT_VALIDATE_CONNECTED_BIT) != 0 ? ESP_OK : ESP_FAIL;
    }
    esp_mqtt_client_stop(client);
    esp_mqtt_client_destroy(client);
    vEventGroupDelete(context.event_group);
    return err;
}

#endif /* CONFIG_HELIX_TRANSPORT_MQTT */
