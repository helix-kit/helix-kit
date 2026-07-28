#include "helix_platform.h"

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

static const char *TAG = "platform";

esp_err_t helix_platform_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    if (ret != ESP_OK) {
        return ret;
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    return ESP_OK;
}

void helix_platform_wait_forever(void)
{
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(60000));
    }
}

void helix_platform_stop_on_error(const char *operation, esp_err_t err)
{
    ESP_LOGE(TAG, "%s failed: %s", operation, esp_err_to_name(err));
    ESP_LOGE(TAG, "startup stopped; fix configuration/networking and reboot");
    helix_platform_wait_forever();
}
