#include "cloud.h"

#include <string.h>

#include "certificates.h"
#include "esp_log.h"
#include "helix_config_store.h"
#include "helix_provisioning.h"
#include "helix_service_endpoint.h"
#include "helix_transport_mqtt.h"

static const char *TAG = "cloud";

static const helix_provisioning_field_t s_cloud_fields[] = {
    {.key = "deviceId", .label = "Device ID", .required = true, .secret = false},
    {.key = "deviceToken", .label = "Device Token", .required = true, .secret = true},
    {.key = "apiUrl", .label = "API URL", .required = true, .secret = false},
    {.key = "mqttHost", .label = "MQTT Host", .required = true, .secret = false},
    {.key = "mqttPort", .label = "MQTT Port", .required = true, .secret = false},
    {.key = "mqttTlsName", .label = "MQTT TLS Name", .required = false, .secret = false},
    {.key = "profileId", .label = "Profile ID", .required = false, .secret = false},
};

esp_err_t cloud_config_load(helix_cloud_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(config, 0, sizeof(*config));
    esp_err_t err = ESP_OK;
    if ((err = helix_config_get_required_string("cloud", "deviceId", config->device_id, sizeof(config->device_id), TAG)) != ESP_OK ||
        (err = helix_config_get_required_string("cloud", "deviceToken", config->device_token, sizeof(config->device_token), TAG)) != ESP_OK ||
        (err = helix_config_get_required_string("cloud", "apiUrl", config->api_url, sizeof(config->api_url), TAG)) != ESP_OK ||
        (err = helix_config_get_required_string("cloud", "mqttHost", config->mqtt_host, sizeof(config->mqtt_host), TAG)) != ESP_OK) {
        return err;
    }

    char mqtt_port[8];
    err = helix_config_get_required_string("cloud", "mqttPort", mqtt_port, sizeof(mqtt_port), TAG);
    if (err != ESP_OK) {
        return err;
    }
    if (!helix_config_parse_u16(mqtt_port, &config->mqtt_port)) {
        return ESP_ERR_INVALID_ARG;
    }

    err = helix_config_get_optional_string("cloud", "mqttTlsName", config->mqtt_tls_name, sizeof(config->mqtt_tls_name));
    if (err != ESP_OK) {
        return err;
    }

    return helix_config_get_optional_string("cloud", "profileId", config->profile_id, sizeof(config->profile_id));
}

static esp_err_t overlay_cloud_config(const cJSON *values, helix_cloud_config_t *config)
{
    if (values == NULL || config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(config, 0, sizeof(*config));
    (void)cloud_config_load(config);
    if (!helix_config_overlay_string(config->device_id, sizeof(config->device_id), values, "deviceId") ||
        !helix_config_overlay_string(config->device_token, sizeof(config->device_token), values, "deviceToken") ||
        !helix_config_overlay_string(config->api_url, sizeof(config->api_url), values, "apiUrl") ||
        !helix_config_overlay_string(config->mqtt_host, sizeof(config->mqtt_host), values, "mqttHost") ||
        !helix_config_overlay_string(config->mqtt_tls_name, sizeof(config->mqtt_tls_name), values, "mqttTlsName") ||
        !helix_config_overlay_string(config->profile_id, sizeof(config->profile_id), values, "profileId")) {
        return ESP_ERR_INVALID_ARG;
    }

    return helix_config_overlay_u16(&config->mqtt_port, values, "mqttPort");
}

bool cloud_config_uses_mqtt_tls(const helix_cloud_config_t *config)
{
    return config != NULL &&
           config->mqtt_tls_name[0] != '\0' &&
           strcmp(config->mqtt_tls_name, "insecure") != 0;
}

static helix_mqtt_transport_config_t build_mqtt_transport_config(
    const helix_cloud_config_t *config,
    const mqtt_cert_bundle_t *bundle
)
{
    const bool use_tls = cloud_config_uses_mqtt_tls(config);
    return (helix_mqtt_transport_config_t) {
        .device_id = config->device_id,
        .broker_host = config->mqtt_host,
        .broker_port = config->mqtt_port,
        .use_tls = use_tls,
        .server_common_name = use_tls ? config->mqtt_tls_name : NULL,
        .root_ca_pem = use_tls && bundle != NULL ? bundle->root_ca_pem : NULL,
        .client_cert_pem = use_tls && bundle != NULL ? bundle->certificate_pem : NULL,
        .client_key_pem = use_tls && bundle != NULL ? bundle->private_key_pem : NULL,
        .keepalive_seconds = 30,
        .on_packet = helix_service_endpoint_receive,
    };
}

static esp_err_t validate_cloud_config(const char *domain, const cJSON *values, bool force, void *context)
{
    (void)domain;
    (void)context;
    if (force) {
        return ESP_OK;
    }

    helix_cloud_config_t candidate;
    esp_err_t err = overlay_cloud_config(values, &candidate);
    if (err != ESP_OK) {
        return err;
    }

#if CONFIG_HELIX_TRANSPORT_MQTT
    mqtt_cert_bundle_t bundle = {0};
    mqtt_cert_bundle_t *bundle_ptr = NULL;
    if (cloud_config_uses_mqtt_tls(&candidate)) {
        mqtt_cert_bundle_clear();
        err = mqtt_cert_bundle_load_or_enroll(&candidate, &bundle);
        if (err != ESP_OK) {
            mqtt_cert_bundle_free(&bundle);
            return err;
        }
        bundle_ptr = &bundle;
    }

    helix_mqtt_transport_config_t mqtt_config = build_mqtt_transport_config(&candidate, bundle_ptr);
    err = helix_mqtt_transport_validate_connection(&mqtt_config, 15000);
    mqtt_cert_bundle_free(&bundle);
#endif /* CONFIG_HELIX_TRANSPORT_MQTT */
    return err;
}

esp_err_t cloud_register_provisioning_domain(void)
{
    helix_provisioning_domain_t cloud = {
        .domain = "cloud",
        .label = "Helix Cloud",
        .fields = s_cloud_fields,
        .field_count = sizeof(s_cloud_fields) / sizeof(s_cloud_fields[0]),
        .restart_required = true,
        .validate = validate_cloud_config,
    };
    return helix_provisioning_register_domain(&cloud);
}

esp_err_t cloud_start_mqtt(const helix_cloud_config_t *config, mqtt_cert_bundle_t *cert_bundle)
{
#if !CONFIG_HELIX_TRANSPORT_MQTT
    (void)config;
    (void)cert_bundle;
    ESP_LOGW(TAG, "MQTT transport disabled at build time");
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ESP_LOGI(TAG, "device_id=%s profile=%s", config->device_id, config->profile_id);
    const bool use_tls = cloud_config_uses_mqtt_tls(config);
    if (use_tls) {
        esp_err_t err = mqtt_cert_bundle_load_or_enroll(config, cert_bundle);
        if (err != ESP_OK) {
            return err;
        }
    }

    helix_mqtt_transport_config_t mqtt_config = build_mqtt_transport_config(
        config,
        use_tls ? cert_bundle : NULL
    );
    esp_err_t err = helix_service_endpoint_attach_transport(helix_mqtt_transport());
    if (err == ESP_OK) {
        err = helix_mqtt_transport_start(&mqtt_config);
    }
    return err;
#endif /* CONFIG_HELIX_TRANSPORT_MQTT */
}
