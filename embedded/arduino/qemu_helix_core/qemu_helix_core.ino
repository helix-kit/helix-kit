// Phase-B probe: does the *actual* ESP32 Helix protocol core compile, link, and
// run on AVR? Drives the real parse -> dispatch -> respond path in-memory (no
// serial-read task yet) using the shared helix_protocol/dispatcher/endpoint C
// core, vendored cJSON, and the esp-compat shim. Prints one HELIX_RESPONSE.
//
// The Helix headers are C (no extern "C" guards), so wrap them for the C++ .ino.

#include <Arduino_FreeRTOS.h>

extern "C" {
#include "cJSON.h"
#include "esp_err.h"
#include "helix_protocol.h"
#include "helix_service_endpoint.h"
#include "helix_transport.h"
#include "service_dispatcher.h"
}

static esp_err_t serial_send_json(const char *json, void *context) {
  (void)context;
  Serial.print(F("HELIX_RESPONSE "));
  Serial.print(json);
  Serial.print('\n');
  return ESP_OK;
}

static helix_transport_t s_transport = {
  "Serial", serial_send_json, nullptr,
};

// gpio-control (probe): reflect the requested level back as gpio-control-state.
static esp_err_t gpio_control_handle(
    const helix_service_invocation_t *invocation, const char *method,
    const cJSON *payload) {
  if (strcmp(method, "set-gpio") != 0) {
    return service_dispatcher_fail(invocation, "unsupported gpio-control command");
  }
  const cJSON *pin_json = cJSON_GetObjectItemCaseSensitive(payload, "pin");
  const cJSON *high_json = cJSON_GetObjectItemCaseSensitive(payload, "high");
  int pin = cJSON_IsNumber(pin_json) ? pin_json->valueint : -1;
  int level = cJSON_IsTrue(high_json) ? 1 : 0;

  cJSON *out = cJSON_CreateObject();
  cJSON *pins = cJSON_CreateArray();
  cJSON *state = cJSON_CreateObject();
  cJSON_AddNumberToObject(state, "pin", pin);
  cJSON_AddNumberToObject(state, "level", level);
  cJSON_AddItemToArray(pins, state);
  cJSON_AddItemToObject(out, "pins", pins);
  return service_dispatcher_respond(invocation, "gpio-control-state", out);
}

static void run_once(const char *json) {
  helix_protocol_packet_t packet = {};
  esp_err_t err = helix_protocol_parse_packet(json, strlen(json), &packet);
  if (err != ESP_OK) {
    Serial.print(F("HELIX_ERROR "));
    Serial.println(esp_err_to_name(err));
    return;
  }
  helix_service_endpoint_receive(&packet, &s_transport, nullptr);
  helix_protocol_packet_free(&packet);
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("HELIX_CORE ready"));

  helix_service_endpoint_init();
  helix_service_endpoint_attach_transport(&s_transport);
  service_dispatcher_register("gpio-control", gpio_control_handle);

  run_once(
      "{\"requestId\":\"probe-1\",\"message\":{\"service\":\"gpio-control\","
      "\"method\":\"set-gpio\",\"payload\":{\"pin\":13,\"high\":true}}}");
}

void loop() {}
