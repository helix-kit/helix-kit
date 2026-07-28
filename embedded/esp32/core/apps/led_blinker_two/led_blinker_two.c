#include "led_blinker_two.h"

#include <stdbool.h>

#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "led_blinker_two";

static void led_blinker_two_task(void *arg)
{
    (void)arg;

    bool led_on = false;
    const TickType_t delay = pdMS_TO_TICKS(CONFIG_LED_BLINKER_TWO_INTERVAL_MS);

    while (true) {
        led_on = !led_on;
        gpio_set_level(CONFIG_LED_BLINKER_TWO_GPIO, led_on ? 1 : 0);
        gpio_set_level(CONFIG_LED_BLINKER_TWO_SECONDARY_GPIO, led_on ? 1 : 0);
        vTaskDelay(delay);
    }
}

esp_err_t led_blinker_two_start(void)
{
    gpio_config_t config = {
        .pin_bit_mask = (1ULL << CONFIG_LED_BLINKER_TWO_GPIO) | (1ULL << CONFIG_LED_BLINKER_TWO_SECONDARY_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&config);
    if (err != ESP_OK) {
        return err;
    }

    ESP_LOGI(TAG, "starting second LED blinker gpio=%d secondary_gpio=%d interval_ms=%d",
             CONFIG_LED_BLINKER_TWO_GPIO,
             CONFIG_LED_BLINKER_TWO_SECONDARY_GPIO,
             CONFIG_LED_BLINKER_TWO_INTERVAL_MS);

    BaseType_t created = xTaskCreate(led_blinker_two_task, "led_blinker_two", 2048, NULL, 5, NULL);
    return created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
