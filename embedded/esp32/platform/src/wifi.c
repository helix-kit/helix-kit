#include "wifi.h"

#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "helix_config_store.h"
#include "helix_provisioning.h"
#include "protocol_examples_common.h"

static const char *TAG = "wifi";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1
#define WIFI_MAX_RETRY_COUNT 8

static EventGroupHandle_t s_wifi_event_group;
static int s_wifi_retry_count;
static bool s_wifi_initialized;

static const helix_provisioning_field_t s_wifi_fields[] = {
    {.key = "ssid", .label = "SSID", .required = true, .secret = false},
    {.key = "password", .label = "Password", .required = true, .secret = true},
};

esp_err_t wifi_config_load(helix_wifi_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(config, 0, sizeof(*config));
    esp_err_t err = helix_config_get_required_string("wifi", "ssid", config->ssid, sizeof(config->ssid), TAG);
    if (err == ESP_OK) {
        err = helix_config_get_required_string("wifi", "password", config->password, sizeof(config->password), TAG);
    }
    return err;
}

static esp_err_t overlay_wifi_config(const cJSON *values, helix_wifi_config_t *config)
{
    if (values == NULL || config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(config, 0, sizeof(*config));
    (void)wifi_config_load(config);
    return helix_config_overlay_string(config->ssid, sizeof(config->ssid), values, "ssid") &&
           helix_config_overlay_string(config->password, sizeof(config->password), values, "password")
        ? ESP_OK
        : ESP_ERR_INVALID_ARG;
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_wifi_retry_count < WIFI_MAX_RETRY_COUNT) {
            s_wifi_retry_count++;
            ESP_LOGW(TAG, "Wi-Fi disconnected, retrying (%d/%d)", s_wifi_retry_count, WIFI_MAX_RETRY_COUNT);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Wi-Fi connected, ip=" IPSTR, IP2STR(&event->ip_info.ip));
        s_wifi_retry_count = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static esp_err_t connect_wifi_from_config(const helix_wifi_config_t *config)
{
    if (s_wifi_event_group == NULL) {
        s_wifi_event_group = xEventGroupCreate();
        if (s_wifi_event_group == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    static bool netif_created;
    if (!netif_created) {
        ESP_ERROR_CHECK(esp_netif_create_default_wifi_sta() == NULL ? ESP_FAIL : ESP_OK);
        netif_created = true;
    }

    esp_err_t err = ESP_OK;
    if (!s_wifi_initialized) {
        wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
        err = esp_wifi_init(&init_config);
        if (err != ESP_OK) {
            return err;
        }

        err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL);
        if (err == ESP_OK) {
            err = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL);
        }
        if (err != ESP_OK) {
            return err;
        }
        s_wifi_initialized = true;
    }

    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
    s_wifi_retry_count = 0;

    wifi_config_t wifi_config = { 0 };
    strlcpy((char *)wifi_config.sta.ssid, config->ssid, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, config->password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    wifi_config.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

    ESP_LOGI(TAG, "connecting Wi-Fi ssid=%s", config->ssid);
    esp_wifi_disconnect();
    if ((err = esp_wifi_set_mode(WIFI_MODE_STA)) != ESP_OK ||
        (err = esp_wifi_set_config(WIFI_IF_STA, &wifi_config)) != ESP_OK ||
        (err = esp_wifi_start()) != ESP_OK) {
        return err;
    }
    // Disable Wi-Fi modem power-save: the default WIFI_PS_MIN_MODEM parks the
    // radio between DTIM beacons (~100 ms), which adds large, jittery latency to
    // downlink packets. For an interactive console bridge, low latency beats the
    // small idle-power saving.
    esp_wifi_set_ps(WIFI_PS_NONE);

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(30000)
    );

    if ((bits & WIFI_CONNECTED_BIT) != 0) {
        return ESP_OK;
    }
    return ESP_FAIL;
}

esp_err_t wifi_connect(const helix_wifi_config_t *config)
{
#if CONFIG_EXAMPLE_CONNECT_WIFI
    return connect_wifi_from_config(config);
#else
    return example_connect();
#endif
}

esp_err_t wifi_validate_credentials(const helix_wifi_config_t *candidate, const helix_wifi_config_t *restore)
{
    if (candidate == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = connect_wifi_from_config(candidate);
    if (err != ESP_OK && restore != NULL) {
        ESP_LOGW(TAG, "candidate Wi-Fi failed, restoring previous Wi-Fi config");
        esp_err_t restore_err = connect_wifi_from_config(restore);
        if (restore_err != ESP_OK) {
            ESP_LOGW(TAG, "previous Wi-Fi restore failed: %s", esp_err_to_name(restore_err));
        }
    }
    return err;
}

static esp_err_t validate_wifi_config(const char *domain, const cJSON *values, bool force, void *context)
{
    (void)domain;
    (void)context;
    if (force) {
        return ESP_OK;
    }

    helix_wifi_config_t candidate;
    esp_err_t err = overlay_wifi_config(values, &candidate);
    if (err != ESP_OK) {
        return err;
    }

    helix_wifi_config_t restore = {0};
    esp_err_t restore_err = wifi_config_load(&restore);
    return wifi_validate_credentials(&candidate, restore_err == ESP_OK ? &restore : NULL);
}

esp_err_t wifi_register_provisioning_domain(void)
{
    helix_provisioning_domain_t wifi = {
        .domain = "wifi",
        .label = "Wi-Fi",
        .fields = s_wifi_fields,
        .field_count = sizeof(s_wifi_fields) / sizeof(s_wifi_fields[0]),
        .restart_required = true,
        .validate = validate_wifi_config,
    };
    return helix_provisioning_register_domain(&wifi);
}
