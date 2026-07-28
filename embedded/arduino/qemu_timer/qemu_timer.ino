// Probe: does a 16-bit Timer1 CTC compare-match interrupt fire under QEMU?
//
// If QEMU emulates Timer1, we see "TICK n" printed ~ every 100ms. If it does
// not, we only ever see "timer probe start" and silence. This decides whether
// we can retarget the FreeRTOS tick off the (unemulated) watchdog onto Timer1.

#include <avr/io.h>
#include <avr/interrupt.h>

volatile uint16_t g_ticks = 0;

ISR(TIMER1_COMPA_vect) {
  g_ticks++;
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("timer probe start"));

  cli();
  TCCR1A = 0;
  TCCR1B = 0;
  TCNT1 = 0;
  // 16MHz / 256 prescaler = 62500 Hz. Compare at 6250 -> 10 Hz (100ms).
  OCR1A = 6250;
  TCCR1B |= (1 << WGM12);              // CTC mode
  TCCR1B |= (1 << CS12);               // prescaler 256
  TIMSK1 |= (1 << OCIE1A);             // enable compare-A interrupt
  sei();
}

void loop() {
  static uint16_t last = 0xFFFF;
  uint16_t t;
  cli();
  t = g_ticks;
  sei();
  if (t != last) {
    last = t;
    Serial.print(F("TICK "));
    Serial.println(t);
  }
}
