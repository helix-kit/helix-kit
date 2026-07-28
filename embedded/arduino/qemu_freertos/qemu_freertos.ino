// FreeRTOS-under-QEMU tick probe.
//
// Two independent tasks print counters at different rates. If the RTOS tick
// fires under qemu-system-avr, we see interleaved "A" and "B" lines with B
// roughly 4x slower than A. If the watchdog tick does NOT fire in QEMU, only
// the first task to run ever prints (no preemption / no vTaskDelay wakeups).

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
  Serial.println(F("SCHEDULER_RETURNED"));  // only if scheduler failed to start
}

void loop() {}
