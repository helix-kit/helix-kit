#include "sdkconfig.h"

#if CONFIG_HELIX_TRANSPORT_SERIAL

#include "helix_transport_serial.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "helix_binary_channel.h"

static const char *TAG = "helix_serial_transport";

// Reflected CRC-32 (poly 0xEDB88820) over a binary frame's header+payload. This
// is an internal frame checksum, not required to match any external standard --
// the host driver (embedded/esp32/commands/simulator.py) runs the identical
// loop, so the only contract is that both ends agree bit-for-bit.
static uint32_t frame_crc_step(uint32_t crc, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++) {
            crc = (crc & 1u) ? ((crc >> 1) ^ 0xEDB88820u) : (crc >> 1);
        }
    }
    return crc;
}

static helix_serial_transport_config_t s_config;
static TaskHandle_t s_task;
static bool s_started;
static SemaphoreHandle_t s_tx_lock;

static esp_err_t serial_send_packet_json(const char *json, void *context)
{
    (void)context;
    return helix_serial_transport_send_packet_json(json);
}

static esp_err_t serial_send_binary(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    void *context
)
{
    (void)context;
    return helix_serial_transport_send_binary(session, offset, data, len);
}

static const helix_transport_t s_transport = {
    .name = "Serial",
    .send_packet_json = serial_send_packet_json,
    .send_binary = serial_send_binary,
};

static const char *configured_string(const char *value, const char *fallback)
{
    return value != NULL ? value : fallback;
}

// Serialises writers of the single UART: the JSON control plane (stdio) and the
// binary side-channel (raw UART bytes). The lock exists only once the transport
// has started; before that a JSON send can still come through unserialised.
static void tx_lock(void)
{
    if (s_tx_lock != NULL) {
        xSemaphoreTake(s_tx_lock, portMAX_DELAY);
    }
}

static void tx_unlock(void)
{
    if (s_tx_lock != NULL) {
        xSemaphoreGive(s_tx_lock);
    }
}

static esp_err_t dispatch_serial_line(const char *line)
{
    const char *prefix = configured_string(s_config.input_prefix, HELIX_SERIAL_DEFAULT_INPUT_PREFIX);
    const size_t prefix_len = strlen(prefix);
    if (strncmp(line, prefix, prefix_len) != 0) {
        return ESP_ERR_NOT_SUPPORTED;
    }

    const char *packet_json = line + prefix_len;
    while (*packet_json == ' ') {
        packet_json++;
    }
    if (*packet_json == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    helix_protocol_packet_t packet = {0};
    esp_err_t err = helix_protocol_parse_packet(packet_json, strlen(packet_json), &packet);
    if (err == ESP_OK && s_config.on_packet != NULL) {
        err = s_config.on_packet(&packet, &s_transport, s_config.user_data);
    }
    helix_protocol_packet_free(&packet);
    return err;
}

static void process_serial_line(const char *line)
{
    esp_err_t err = dispatch_serial_line(line);
    if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
        const char *error_prefix = configured_string(s_config.error_prefix, HELIX_SERIAL_DEFAULT_ERROR_PREFIX);
        printf("%s%s\n", error_prefix, esp_err_to_name(err));
        fflush(stdout);
    }
}

// Read exactly `n` bytes from the UART, tolerating short reads but bailing out
// if the stream stalls for several seconds mid-frame (avoids a wedged transfer
// blocking the JSON control plane forever).
static bool serial_read_exact(uint8_t *buf, size_t n)
{
    size_t got = 0;
    int idle = 0;
    while (got < n) {
        int read = uart_read_bytes(s_config.uart_num, buf + got, n - got, pdMS_TO_TICKS(200));
        if (read > 0) {
            got += (size_t)read;
            idle = 0;
        } else if (++idle > 25) { /* ~5s with no progress */
            return false;
        }
    }
    return true;
}

// Consume a binary data frame after the 0x02 marker byte has been read. See
// helix_transport_serial.h for the wire layout. Decoded chunks are forwarded to
// the binary channel consumer (the file-transfer service).
static void receive_binary_frame(uint8_t *payload_buf)
{
    uint8_t header[HELIX_SERIAL_BINARY_HEADER_BYTES];
    if (!serial_read_exact(header, sizeof(header))) {
        ESP_LOGW(TAG, "binary frame header timed out");
        return;
    }

    const uint8_t version = header[0];
    const uint16_t session = (uint16_t)header[1] | ((uint16_t)header[2] << 8);
    const uint32_t offset = (uint32_t)header[3] | ((uint32_t)header[4] << 8) |
                            ((uint32_t)header[5] << 16) | ((uint32_t)header[6] << 24);
    const uint16_t len = (uint16_t)header[7] | ((uint16_t)header[8] << 8);

    if (version != HELIX_SERIAL_BINARY_VERSION || len > HELIX_SERIAL_BINARY_MAX_PAYLOAD) {
        ESP_LOGW(TAG, "binary frame rejected (version=%u len=%u)", version, len);
        return;
    }

    if (len > 0 && !serial_read_exact(payload_buf, len)) {
        ESP_LOGW(TAG, "binary frame payload timed out (len=%u)", len);
        return;
    }

    uint8_t crc_bytes[4];
    if (!serial_read_exact(crc_bytes, sizeof(crc_bytes))) {
        ESP_LOGW(TAG, "binary frame crc timed out");
        return;
    }
    const uint32_t crc_expected = (uint32_t)crc_bytes[0] | ((uint32_t)crc_bytes[1] << 8) |
                                  ((uint32_t)crc_bytes[2] << 16) | ((uint32_t)crc_bytes[3] << 24);

    uint32_t crc = 0xFFFFFFFFu;
    crc = frame_crc_step(crc, header, sizeof(header));
    crc = frame_crc_step(crc, payload_buf, len);
    crc ^= 0xFFFFFFFFu;
    if (crc != crc_expected) {
        ESP_LOGW(TAG, "binary frame crc mismatch session=%u offset=%u computed=%08x expected=%08x",
                 session, (unsigned)offset, (unsigned)crc, (unsigned)crc_expected);
        return;
    }

    esp_err_t err = helix_binary_channel_ingest(session, offset, payload_buf, len, &s_transport);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "binary chunk rejected session=%u offset=%u: %s",
                 session, (unsigned)offset, esp_err_to_name(err));
    }
}

static void serial_transport_task(void *arg)
{
    (void)arg;

    size_t line_bytes = s_config.line_bytes > 0
        ? s_config.line_bytes
        : HELIX_SERIAL_DEFAULT_LINE_BYTES;
    char *line = calloc(1, line_bytes);
    uint8_t *binary_payload = calloc(1, HELIX_SERIAL_BINARY_MAX_PAYLOAD);
    if (line == NULL || binary_payload == NULL) {
        ESP_LOGE(TAG, "failed to allocate serial buffers");
        free(line);
        free(binary_payload);
        vTaskDelete(NULL);
        return;
    }

    size_t line_len = 0;
    const TickType_t read_delay = pdMS_TO_TICKS(
        s_config.read_delay_ms > 0 ? s_config.read_delay_ms : HELIX_SERIAL_DEFAULT_READ_DELAY_MS
    );

    while (true) {
        uint8_t byte = 0;
        int read = uart_read_bytes(s_config.uart_num, &byte, 1, read_delay);
        if (read <= 0) {
            continue;
        }

        if (line_len == 0 && byte == HELIX_SERIAL_BINARY_MARKER) {
            receive_binary_frame(binary_payload);
            continue;
        }

        if (byte == '\r') {
            continue;
        }
        if (byte != '\n') {
            if (line_len + 1 >= line_bytes) {
                ESP_LOGW(TAG, "serial line exceeded %u bytes; dropping partial line", (unsigned)line_bytes);
                line_len = 0;
            } else {
                line[line_len++] = (char)byte;
            }
            continue;
        }

        line[line_len] = '\0';
        line_len = 0;
        process_serial_line(line);
    }
}

esp_err_t helix_serial_transport_start(const helix_serial_transport_config_t *config)
{
    if (config == NULL || config->on_packet == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_started) {
        return ESP_OK;
    }

    s_config = *config;
    if (s_config.uart_num < 0) {
        s_config.uart_num = UART_NUM_0;
    }

    if (s_tx_lock == NULL) {
        s_tx_lock = xSemaphoreCreateMutex();
        if (s_tx_lock == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    const size_t uart_buffer_bytes = s_config.uart_buffer_bytes > 0
        ? s_config.uart_buffer_bytes
        : HELIX_SERIAL_DEFAULT_UART_BUFFER_BYTES;
    esp_err_t err = uart_driver_install(s_config.uart_num, uart_buffer_bytes, 0, 0, NULL, 0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "failed to install UART driver: %s", esp_err_to_name(err));
        return err;
    }

    const uint32_t stack_bytes = s_config.task_stack_bytes > 0
        ? s_config.task_stack_bytes
        : HELIX_SERIAL_DEFAULT_STACK_BYTES;
    const UBaseType_t priority = s_config.task_priority > 0 ? s_config.task_priority : 5;
    BaseType_t task_created = xTaskCreate(
        serial_transport_task,
        "helix_serial",
        stack_bytes,
        NULL,
        priority,
        &s_task
    );
    if (task_created != pdPASS) {
        s_task = NULL;
        return ESP_ERR_NO_MEM;
    }

    s_started = true;
    ESP_LOGI(TAG, "serial command transport started on UART%d", s_config.uart_num);
    return ESP_OK;
}

esp_err_t helix_serial_transport_send_packet_json(const char *json)
{
    if (json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const char *output_prefix = configured_string(s_config.output_prefix, HELIX_SERIAL_DEFAULT_OUTPUT_PREFIX);
    tx_lock();
    printf("%s%s\n", output_prefix, json);
    fflush(stdout);
    tx_unlock();
    return ESP_OK;
}

esp_err_t helix_serial_transport_send_binary(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len
)
{
    if (!s_started) {
        return ESP_ERR_INVALID_STATE;
    }
    if (data == NULL || len == 0 || len > HELIX_SERIAL_BINARY_MAX_PAYLOAD) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t header[1 + HELIX_SERIAL_BINARY_HEADER_BYTES];
    header[0] = HELIX_SERIAL_BINARY_MARKER;
    header[1] = HELIX_SERIAL_BINARY_VERSION;
    header[2] = (uint8_t)(session & 0xFF);
    header[3] = (uint8_t)(session >> 8);
    header[4] = (uint8_t)(offset & 0xFF);
    header[5] = (uint8_t)((offset >> 8) & 0xFF);
    header[6] = (uint8_t)((offset >> 16) & 0xFF);
    header[7] = (uint8_t)((offset >> 24) & 0xFF);
    header[8] = (uint8_t)(len & 0xFF);
    header[9] = (uint8_t)((len >> 8) & 0xFF);

    uint32_t crc = frame_crc_step(0xFFFFFFFFu, &header[1], HELIX_SERIAL_BINARY_HEADER_BYTES);
    crc = frame_crc_step(crc, data, len);
    crc ^= 0xFFFFFFFFu;
    const uint8_t trailer[4] = {
        (uint8_t)(crc & 0xFF),
        (uint8_t)((crc >> 8) & 0xFF),
        (uint8_t)((crc >> 16) & 0xFF),
        (uint8_t)((crc >> 24) & 0xFF),
    };

    // The JSON control plane goes out through stdio on this same UART; take the
    // TX lock and drain stdout so a frame is never interleaved into a log line.
    tx_lock();
    fflush(stdout);
    uart_write_bytes(s_config.uart_num, header, sizeof(header));
    uart_write_bytes(s_config.uart_num, data, len);
    uart_write_bytes(s_config.uart_num, trailer, sizeof(trailer));
    tx_unlock();
    return ESP_OK;
}

const helix_transport_t *helix_serial_transport(void)
{
    return &s_transport;
}

#endif /* CONFIG_HELIX_TRANSPORT_SERIAL */
