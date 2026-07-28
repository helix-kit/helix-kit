// Helix serial-protocol node for Arduino Leonardo (ATmega32u4, native USB CDC): same newline-framed protocol as the ESP32 serial transport, gpio-control on real pins.
// Native USB CDC: opening the port does NOT reset the sketch (only a 1200 bps touch), so there's no boot race.

#include <ArduinoJson.h>

static const char OUTPUT_PREFIX[] = "HELIX_RESPONSE ";
static const char ERROR_PREFIX[] = "HELIX_ERROR ";

static const size_t LINE_MAX = 220;
static char lineBuf[LINE_MAX];
static size_t lineLen = 0;

void setup() {
  Serial.begin(115200);
}

static void handleLine(char* line) {
  char* brace = strchr(line, '{');
  if (brace == nullptr) {
    return;
  }

  JsonDocument in;
  DeserializationError err = deserializeJson(in, brace);
  if (err) {
    Serial.print(ERROR_PREFIX);
    Serial.println(err.c_str());
    return;
  }

  const char* requestId = in["requestId"] | "";
  const char* service = in["message"]["service"] | "gpio-control";
  const char* method = in["message"]["method"] | "";
  JsonVariant payload = in["message"]["payload"];
  int pin = payload["pin"] | -1;

  int level = 0;
  if (pin >= 0) {
    if (strcmp(method, "set-gpio") == 0) {
      bool high = payload["high"] | false;
      pinMode(pin, OUTPUT);
      digitalWrite(pin, high ? HIGH : LOW);
      level = high ? 1 : 0;
    } else {
      level = digitalRead(pin) ? 1 : 0;
    }
  }

  JsonDocument out;
  out["requestId"] = requestId;
  out["message"]["service"] = service;
  out["message"]["method"] = "gpio-control-state";
  JsonArray pins = out["message"]["payload"]["pins"].to<JsonArray>();
  JsonObject pinState = pins.add<JsonObject>();
  pinState["pin"] = pin;
  pinState["level"] = level;

  Serial.print(OUTPUT_PREFIX);
  serializeJson(out, Serial);
  Serial.print('\n');
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
    } else if (c != '\r') {
      if (lineLen < LINE_MAX - 1) {
        lineBuf[lineLen++] = c;
      } else {
        lineLen = 0;  // overflow guard
      }
    }
  }
}
