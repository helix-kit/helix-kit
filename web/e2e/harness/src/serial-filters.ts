import type { SerialPortFilter } from '@helix/transport-serial';

// ESP32 USB-UART bridges: CP210x, CH34x, FTDI, Espressif native, Microchip.
export const ESP32_SERIAL_FILTERS: readonly SerialPortFilter[] = [
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1a86 },
  { usbVendorId: 0x0403 },
  { usbVendorId: 0x303a },
  { usbVendorId: 0x04d8 },
];

// Arduino native USB: Arduino SA / Arduino srl.
export const ARDUINO_SERIAL_FILTERS: readonly SerialPortFilter[] = [
  { usbVendorId: 0x2341 },
  { usbVendorId: 0x2a03 },
];
