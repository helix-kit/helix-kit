#include "status_display.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "sdkconfig.h"
#include "service_dispatcher.h"
#include "status_display_contract.h"

#define DISPLAY_WIDTH 128
#define DISPLAY_HEIGHT 32
#define DISPLAY_PAGES (DISPLAY_HEIGHT / 8)
#define DISPLAY_TEXT_MAX 96
#define DISPLAY_I2C_PORT I2C_NUM_0

static const char *TAG = "status_display";
static SemaphoreHandle_t s_lock;
static bool s_ready;
static char s_text[DISPLAY_TEXT_MAX] = "Helix";
static i2c_master_bus_handle_t s_i2c_bus;
static i2c_master_dev_handle_t s_i2c_device;

static void font5x7(char ch, uint8_t out[5])
{
    memset(out, 0, 5);
    switch ((char)toupper((int)(unsigned char)ch)) {
    case '0': { const uint8_t v[5] = {0x3E, 0x51, 0x49, 0x45, 0x3E}; memcpy(out, v, 5); break; }
    case '1': { const uint8_t v[5] = {0x00, 0x42, 0x7F, 0x40, 0x00}; memcpy(out, v, 5); break; }
    case '2': { const uint8_t v[5] = {0x42, 0x61, 0x51, 0x49, 0x46}; memcpy(out, v, 5); break; }
    case '3': { const uint8_t v[5] = {0x21, 0x41, 0x45, 0x4B, 0x31}; memcpy(out, v, 5); break; }
    case '4': { const uint8_t v[5] = {0x18, 0x14, 0x12, 0x7F, 0x10}; memcpy(out, v, 5); break; }
    case '5': { const uint8_t v[5] = {0x27, 0x45, 0x45, 0x45, 0x39}; memcpy(out, v, 5); break; }
    case '6': { const uint8_t v[5] = {0x3C, 0x4A, 0x49, 0x49, 0x30}; memcpy(out, v, 5); break; }
    case '7': { const uint8_t v[5] = {0x01, 0x71, 0x09, 0x05, 0x03}; memcpy(out, v, 5); break; }
    case '8': { const uint8_t v[5] = {0x36, 0x49, 0x49, 0x49, 0x36}; memcpy(out, v, 5); break; }
    case '9': { const uint8_t v[5] = {0x06, 0x49, 0x49, 0x29, 0x1E}; memcpy(out, v, 5); break; }
    case 'A': { const uint8_t v[5] = {0x7E, 0x11, 0x11, 0x11, 0x7E}; memcpy(out, v, 5); break; }
    case 'B': { const uint8_t v[5] = {0x7F, 0x49, 0x49, 0x49, 0x36}; memcpy(out, v, 5); break; }
    case 'C': { const uint8_t v[5] = {0x3E, 0x41, 0x41, 0x41, 0x22}; memcpy(out, v, 5); break; }
    case 'D': { const uint8_t v[5] = {0x7F, 0x41, 0x41, 0x22, 0x1C}; memcpy(out, v, 5); break; }
    case 'E': { const uint8_t v[5] = {0x7F, 0x49, 0x49, 0x49, 0x41}; memcpy(out, v, 5); break; }
    case 'F': { const uint8_t v[5] = {0x7F, 0x09, 0x09, 0x09, 0x01}; memcpy(out, v, 5); break; }
    case 'G': { const uint8_t v[5] = {0x3E, 0x41, 0x49, 0x49, 0x7A}; memcpy(out, v, 5); break; }
    case 'H': { const uint8_t v[5] = {0x7F, 0x08, 0x08, 0x08, 0x7F}; memcpy(out, v, 5); break; }
    case 'I': { const uint8_t v[5] = {0x00, 0x41, 0x7F, 0x41, 0x00}; memcpy(out, v, 5); break; }
    case 'J': { const uint8_t v[5] = {0x20, 0x40, 0x41, 0x3F, 0x01}; memcpy(out, v, 5); break; }
    case 'K': { const uint8_t v[5] = {0x7F, 0x08, 0x14, 0x22, 0x41}; memcpy(out, v, 5); break; }
    case 'L': { const uint8_t v[5] = {0x7F, 0x40, 0x40, 0x40, 0x40}; memcpy(out, v, 5); break; }
    case 'M': { const uint8_t v[5] = {0x7F, 0x02, 0x0C, 0x02, 0x7F}; memcpy(out, v, 5); break; }
    case 'N': { const uint8_t v[5] = {0x7F, 0x04, 0x08, 0x10, 0x7F}; memcpy(out, v, 5); break; }
    case 'O': { const uint8_t v[5] = {0x3E, 0x41, 0x41, 0x41, 0x3E}; memcpy(out, v, 5); break; }
    case 'P': { const uint8_t v[5] = {0x7F, 0x09, 0x09, 0x09, 0x06}; memcpy(out, v, 5); break; }
    case 'Q': { const uint8_t v[5] = {0x3E, 0x41, 0x51, 0x21, 0x5E}; memcpy(out, v, 5); break; }
    case 'R': { const uint8_t v[5] = {0x7F, 0x09, 0x19, 0x29, 0x46}; memcpy(out, v, 5); break; }
    case 'S': { const uint8_t v[5] = {0x46, 0x49, 0x49, 0x49, 0x31}; memcpy(out, v, 5); break; }
    case 'T': { const uint8_t v[5] = {0x01, 0x01, 0x7F, 0x01, 0x01}; memcpy(out, v, 5); break; }
    case 'U': { const uint8_t v[5] = {0x3F, 0x40, 0x40, 0x40, 0x3F}; memcpy(out, v, 5); break; }
    case 'V': { const uint8_t v[5] = {0x1F, 0x20, 0x40, 0x20, 0x1F}; memcpy(out, v, 5); break; }
    case 'W': { const uint8_t v[5] = {0x3F, 0x40, 0x38, 0x40, 0x3F}; memcpy(out, v, 5); break; }
    case 'X': { const uint8_t v[5] = {0x63, 0x14, 0x08, 0x14, 0x63}; memcpy(out, v, 5); break; }
    case 'Y': { const uint8_t v[5] = {0x07, 0x08, 0x70, 0x08, 0x07}; memcpy(out, v, 5); break; }
    case 'Z': { const uint8_t v[5] = {0x61, 0x51, 0x49, 0x45, 0x43}; memcpy(out, v, 5); break; }
    case ':': { const uint8_t v[5] = {0x00, 0x36, 0x36, 0x00, 0x00}; memcpy(out, v, 5); break; }
    case '-': { const uint8_t v[5] = {0x08, 0x08, 0x08, 0x08, 0x08}; memcpy(out, v, 5); break; }
    case '.': { const uint8_t v[5] = {0x00, 0x60, 0x60, 0x00, 0x00}; memcpy(out, v, 5); break; }
    case '/': { const uint8_t v[5] = {0x20, 0x10, 0x08, 0x04, 0x02}; memcpy(out, v, 5); break; }
    default:
        break;
    }
}

static esp_err_t i2c_write_bytes(const uint8_t *data, size_t len)
{
    if (s_i2c_device == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    return i2c_master_transmit(s_i2c_device, data, len, 100);
}

static esp_err_t oled_cmd(uint8_t cmd)
{
    const uint8_t data[2] = {0x00, cmd};
    return i2c_write_bytes(data, sizeof(data));
}

static esp_err_t oled_data(const uint8_t *data, size_t len)
{
    uint8_t packet[DISPLAY_WIDTH + 1];
    if (len > DISPLAY_WIDTH) {
        return ESP_ERR_INVALID_SIZE;
    }
    packet[0] = 0x40;
    memcpy(&packet[1], data, len);
    return i2c_write_bytes(packet, len + 1);
}

static esp_err_t oled_clear(void)
{
    uint8_t zeros[DISPLAY_WIDTH] = {0};
    for (uint8_t page = 0; page < DISPLAY_PAGES; page++) {
        ESP_RETURN_ON_ERROR(oled_cmd(0xB0 | page), TAG, "set page");
        ESP_RETURN_ON_ERROR(oled_cmd(0x00), TAG, "set low column");
        ESP_RETURN_ON_ERROR(oled_cmd(0x10), TAG, "set high column");
        ESP_RETURN_ON_ERROR(oled_data(zeros, sizeof(zeros)), TAG, "clear page");
    }
    return ESP_OK;
}

static esp_err_t oled_init(void)
{
    if (s_i2c_device == NULL) {
        i2c_master_bus_config_t bus_config = {
            .clk_source = I2C_CLK_SRC_DEFAULT,
            .i2c_port = DISPLAY_I2C_PORT,
            .scl_io_num = (gpio_num_t)CONFIG_STATUS_DISPLAY_SCL_GPIO,
            .sda_io_num = (gpio_num_t)CONFIG_STATUS_DISPLAY_SDA_GPIO,
            .glitch_ignore_cnt = 7,
            .flags.enable_internal_pullup = true,
        };
        ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_config, &s_i2c_bus), TAG, "i2c bus");

        i2c_device_config_t device_config = {
            .dev_addr_length = I2C_ADDR_BIT_LEN_7,
            .device_address = CONFIG_STATUS_DISPLAY_I2C_ADDRESS,
            .scl_speed_hz = CONFIG_STATUS_DISPLAY_I2C_HZ,
        };
        ESP_RETURN_ON_ERROR(
            i2c_master_bus_add_device(s_i2c_bus, &device_config, &s_i2c_device),
            TAG,
            "i2c device"
        );
    }

    esp_err_t probe_err = i2c_master_probe(
        s_i2c_bus,
        CONFIG_STATUS_DISPLAY_I2C_ADDRESS,
        100
    );
    if (probe_err != ESP_OK) {
        ESP_LOGW(
            TAG,
            "I2C probe failed addr=0x%02x sda=%d scl=%d: %s",
            CONFIG_STATUS_DISPLAY_I2C_ADDRESS,
            CONFIG_STATUS_DISPLAY_SDA_GPIO,
            CONFIG_STATUS_DISPLAY_SCL_GPIO,
            esp_err_to_name(probe_err)
        );
        return probe_err;
    }

    const uint8_t init[] = {
        0xAE, 0xD5, 0x80, 0xA8, 0x1F, 0xD3, 0x00, 0x40,
        0x8D, 0x14, 0x20, 0x00, 0xA1, 0xC8, 0xDA, 0x02,
        0x81, 0x8F, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6,
        0xAF,
    };
    for (size_t i = 0; i < sizeof(init); i++) {
        esp_err_t err = oled_cmd(init[i]);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "OLED init command failed index=%u cmd=0x%02x: %s", (unsigned)i, init[i], esp_err_to_name(err));
            return err;
        }
    }
    return oled_clear();
}

static esp_err_t oled_draw_text_locked(const char *text)
{
    char rows[DISPLAY_PAGES][22];
    memset(rows, ' ', sizeof(rows));
    for (size_t page = 0; page < DISPLAY_PAGES; page++) {
        rows[page][21] = '\0';
    }

    size_t row = 0;
    size_t col = 0;
    for (const char *cursor = text; cursor != NULL && *cursor != '\0' && row < DISPLAY_PAGES; cursor++) {
        if (*cursor == '\n') {
            row++;
            col = 0;
            continue;
        }
        if (col >= 21) {
            row++;
            col = 0;
            if (row >= DISPLAY_PAGES) {
                break;
            }
        }
        rows[row][col++] = *cursor;
    }

    for (uint8_t page = 0; page < DISPLAY_PAGES; page++) {
        uint8_t line[DISPLAY_WIDTH] = {0};
        size_t offset = 0;
        for (size_t i = 0; i < 21 && offset + 6 <= sizeof(line); i++) {
            uint8_t glyph[5];
            font5x7(rows[page][i], glyph);
            memcpy(&line[offset], glyph, sizeof(glyph));
            offset += 6;
        }
        ESP_RETURN_ON_ERROR(oled_cmd(0xB0 | page), TAG, "set page");
        ESP_RETURN_ON_ERROR(oled_cmd(0x00), TAG, "set low column");
        ESP_RETURN_ON_ERROR(oled_cmd(0x10), TAG, "set high column");
        ESP_RETURN_ON_ERROR(oled_data(line, sizeof(line)), TAG, "draw page");
    }
    return ESP_OK;
}

static void copy_text_locked(const char *text)
{
    const char *source = (text != NULL && text[0] != '\0') ? text : " ";
    strlcpy(s_text, source, sizeof(s_text));
}

esp_err_t status_display_set_text(const char *text)
{
    if (s_lock == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);
    copy_text_locked(text);
    esp_err_t err = s_ready ? oled_draw_text_locked(s_text) : ESP_ERR_INVALID_STATE;
    xSemaphoreGive(s_lock);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "display text stored but not drawn: %s", esp_err_to_name(err));
    }
    return err;
}

static esp_err_t publish_state(const helix_service_invocation_t *invocation)
{
    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);
    cJSON_AddStringToObject(payload, "text", s_text);
    cJSON_AddBoolToObject(payload, "ready", s_ready);
    xSemaphoreGive(s_lock);
    return service_dispatcher_respond(
        invocation,
        STATUS_DISPLAY_STATE_MESSAGE,
        payload
    );
}

static esp_err_t handle_set_text(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    status_display_set_text_request_t request;
    esp_err_t err = status_display_parse_set_text_request(payload, &request);
    if (err != ESP_OK || request.text == NULL || request.text[0] == '\0') {
        return service_dispatcher_fail(invocation, "invalid set-text request");
    }

    err = status_display_set_text(request.text);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return service_dispatcher_fail(invocation, esp_err_to_name(err));
    }
    return publish_state(invocation);
}

static esp_err_t status_display_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (strcmp(method, STATUS_DISPLAY_SET_TEXT_METHOD) == 0) {
        return handle_set_text(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unsupported status-display command");
}

esp_err_t status_display_start(void)
{
    ESP_LOGI(
        TAG,
        "starting status display service sda=%d scl=%d addr=0x%02x",
        CONFIG_STATUS_DISPLAY_SDA_GPIO,
        CONFIG_STATUS_DISPLAY_SCL_GPIO,
        CONFIG_STATUS_DISPLAY_I2C_ADDRESS
    );

    if (s_lock == NULL) {
        s_lock = xSemaphoreCreateMutex();
        if (s_lock == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    esp_err_t err = oled_init();
    if (err == ESP_OK) {
        s_ready = true;
        ESP_ERROR_CHECK(status_display_set_text(s_text));
    } else {
        s_ready = false;
        ESP_LOGW(TAG, "OLED init failed: %s", esp_err_to_name(err));
    }

    return service_dispatcher_register(STATUS_DISPLAY_SERVICE, status_display_handle_command);
}
