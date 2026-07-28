// Helix node firmware for AVR (serial-only): same Helix protocol core as the ESP32 over serial framing.
// AVR has no WiFi/BLE; developed against qemu-system-avr, RTOS tick from Timer1 (not the WDT).

#include <Arduino_FreeRTOS.h>

extern "C" {
#include "cJSON.h"
#include "esp_err.h"
#include "helix_protocol.h"
#include "helix_service_endpoint.h"
#include "helix_transport.h"
#include "service_dispatcher.h"
}

static const char INPUT_PREFIX[] = "SERVICE ";
static const char OUTPUT_PREFIX[] = "HELIX_RESPONSE ";
static const char ERROR_PREFIX[] = "HELIX_ERROR ";
static const size_t LINE_MAX = 200;

extern "C" esp_err_t serial_send_json(const char *json, void *context) {
  (void)context;
  Serial.print(OUTPUT_PREFIX);
  Serial.print(json);
  Serial.print('\n');
  return ESP_OK;
}

static helix_transport_t s_transport = {"Serial", serial_send_json, nullptr};

static void process_line(char *line) {
  const size_t prefix_len = strlen(INPUT_PREFIX);
  if (strncmp(line, INPUT_PREFIX, prefix_len) != 0) {
    return;
  }
  const char *json = line + prefix_len;
  while (*json == ' ') {
    json++;
  }

  helix_protocol_packet_t packet = {};
  esp_err_t err = helix_protocol_parse_packet(json, strlen(json), &packet);
  if (err == ESP_OK) {
    err = helix_service_endpoint_receive(&packet, &s_transport, nullptr);
  }
  helix_protocol_packet_free(&packet);

  if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
    Serial.print(ERROR_PREFIX);
    Serial.println(esp_err_to_name(err));
  }
}

static void serial_transport_task(void *arg) {
  (void)arg;
  static char line[LINE_MAX];
  size_t len = 0;
  for (;;) {
    const int c = Serial.read();
    if (c < 0) {
      // No byte ready: nap briefly; while a packet streams in we drain continuously so the RX ring never overflows.
      vTaskDelay(pdMS_TO_TICKS(2));
      continue;
    }
    if (c == '\n') {
      line[len] = '\0';
      process_line(line);
      len = 0;
    } else if (c != '\r') {
      if (len < LINE_MAX - 1) {
        line[len++] = (char)c;
      } else {
        len = 0;  // overflow guard
      }
    }
  }
}

// Same service/method/response contract as the ESP32 app, driving real AVR pins.
static esp_err_t respond_pin_state(const helix_service_invocation_t *invocation,
                                   int pin, int level) {
  cJSON *payload = cJSON_CreateObject();
  cJSON *pins = cJSON_CreateArray();
  cJSON *state = cJSON_CreateObject();
  if (payload == nullptr || pins == nullptr || state == nullptr) {
    cJSON_Delete(payload);
    cJSON_Delete(pins);
    cJSON_Delete(state);
    return ESP_ERR_NO_MEM;
  }
  cJSON_AddNumberToObject(state, "pin", pin);
  cJSON_AddNumberToObject(state, "level", level);
  cJSON_AddItemToArray(pins, state);
  cJSON_AddItemToObject(payload, "pins", pins);
  return service_dispatcher_respond(invocation, "gpio-control-state", payload);
}

static esp_err_t gpio_control_handle(const helix_service_invocation_t *invocation,
                                     const char *method, const cJSON *payload) {
  const cJSON *pin_json = cJSON_GetObjectItemCaseSensitive(payload, "pin");
  if (!cJSON_IsNumber(pin_json)) {
    return service_dispatcher_fail(invocation, "pin must be a number");
  }
  const int pin = pin_json->valueint;

  if (strcmp(method, "set-gpio") == 0) {
    const cJSON *high_json = cJSON_GetObjectItemCaseSensitive(payload, "high");
    const bool high = cJSON_IsTrue(high_json);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, high ? HIGH : LOW);
    // Report the commanded level: QEMU does not model output-pin readback.
    return respond_pin_state(invocation, pin, high ? 1 : 0);
  }
  if (strcmp(method, "read-gpio") == 0) {
    pinMode(pin, INPUT);
    return respond_pin_state(invocation, pin, digitalRead(pin) ? 1 : 0);
  }
  return service_dispatcher_fail(invocation, "unsupported gpio-control command");
}

void setup() {
  Serial.begin(115200);

  helix_service_endpoint_init();
  helix_service_endpoint_attach_transport(&s_transport);
  service_dispatcher_register("gpio-control", gpio_control_handle);

  Serial.println(F("HELIX_NODE ready"));

  // cJSON parse + print are deeply recursive; the transport task needs stack for the whole chain.
  xTaskCreate(serial_transport_task, "serial", 1024, nullptr, 2, nullptr);
  vTaskStartScheduler();

  Serial.println(F("HELIX_NODE scheduler failed to start"));
}

void loop() {}
