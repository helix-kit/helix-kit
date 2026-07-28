#include "time_sync.h"

#include <time.h>

#include "esp_log.h"
#include "esp_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "time_sync";

void time_format_utc(char *out, size_t out_len)
{
    time_t now = time(NULL);
    struct tm tm;
    gmtime_r(&now, &tm);
    strftime(out, out_len, "%Y-%m-%dT%H:%M:%SZ", &tm);
}

void time_sync(void)
{
    ESP_LOGI(TAG, "starting SNTP sync via %s", CONFIG_SNTP_SERVER);
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, CONFIG_SNTP_SERVER);
    esp_sntp_init();

    for (int attempt = 0; attempt < 20; attempt++) {
        time_t now = time(NULL);
        if (now > 1700000000) {
            ESP_LOGI(TAG, "time synchronized");
            return;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    ESP_LOGW(TAG, "time sync did not complete; TLS validation may fail if RTC is unset");
}
