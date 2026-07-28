// FreeRTOS-under-QEMU tick probe: two tasks print at different rates; interleaved A/B means the RTOS tick fires, silence after the first task means it doesn't.

#include <Arduino_FreeRTOS.h>

static void taskA(void *pv) {
  (void)pv;
  uint16_t n = 0;
  for (;;) {
    Serial.print(F("A "));
    Serial.println(n++);
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

static void taskB(void *pv) {
  (void)pv;
  uint16_t n = 0;
  for (;;) {
    Serial.print(F("B "));
    Serial.println(n++);
    vTaskDelay(pdMS_TO_TICKS(400));
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("FREERTOS_PROBE start"));
  xTaskCreate(taskA, "A", 128, NULL, 1, NULL);
  xTaskCreate(taskB, "B", 128, NULL, 1, NULL);
  vTaskStartScheduler();
  Serial.println(F("SCHEDULER_RETURNED"));  // only if the scheduler failed to start
}

void loop() {}
