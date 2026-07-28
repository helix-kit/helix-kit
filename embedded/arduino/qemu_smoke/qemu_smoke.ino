// Minimal QEMU AVR serial smoke test.
//
// Proves the qemu-system-avr USART <-> host chardev path works both ways:
// prints a banner on boot, then echoes every received line back prefixed with
// "ECHO ". Used only to validate the simulator harness before the real Helix
// FreeRTOS firmware lands.

static const size_t LINE_MAX = 128;
static char lineBuf[LINE_MAX];
static size_t lineLen = 0;

void setup() {
  Serial.begin(115200);
  Serial.println(F("QEMU_SMOKE ready"));
}

static void handleLine(char* line) {
  Serial.print(F("ECHO "));
  Serial.println(line);
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
        lineLen = 0;
      }
    }
  }
}
