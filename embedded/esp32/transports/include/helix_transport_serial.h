#pragma once

#include <stddef.h>
#include <stdint.h>

#include "driver/uart.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "helix_transport.h"

#define HELIX_SERIAL_DEFAULT_LINE_BYTES 2048
#define HELIX_SERIAL_DEFAULT_READ_DELAY_MS 50
#define HELIX_SERIAL_DEFAULT_STACK_BYTES 8192
#define HELIX_SERIAL_DEFAULT_UART_BUFFER_BYTES 2048
#define HELIX_SERIAL_DEFAULT_INPUT_PREFIX "SERVICE "
#define HELIX_SERIAL_DEFAULT_OUTPUT_PREFIX "HELIX_RESPONSE "
#define HELIX_SERIAL_DEFAULT_ERROR_PREFIX "HELIX_ERROR "

// Binary data side-channel framing, multiplexed on the same UART as the newline-delimited JSON lines. Inbound a frame is recognised only at line start; outbound the host resyncs on the marker and validates CRC.
// Layout: marker(0x02) ver(1) session(2 LE) offset(4 LE) len(2 LE) payload[len] crc32(4 LE); crc32 covers ver..payload.
#define HELIX_SERIAL_BINARY_MARKER 0x02
#define HELIX_SERIAL_BINARY_VERSION 0x01
#define HELIX_SERIAL_BINARY_HEADER_BYTES 9
#define HELIX_SERIAL_BINARY_MAX_PAYLOAD 1024

typedef struct {
    uart_port_t uart_num;
    size_t line_bytes;
    size_t uart_buffer_bytes;
    uint32_t read_delay_ms;
    uint32_t task_stack_bytes;
    UBaseType_t task_priority;
    const char *input_prefix;
    const char *output_prefix;
    const char *error_prefix;
    helix_transport_packet_handler_t on_packet;
    void *user_data;
} helix_serial_transport_config_t;

esp_err_t helix_serial_transport_start(const helix_serial_transport_config_t *config);
esp_err_t helix_serial_transport_send_packet_json(const char *json);
esp_err_t helix_serial_transport_send_binary(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len
);
const helix_transport_t *helix_serial_transport(void);
