import { defineFeature } from '@helix-hq/backend/features';

// GPIO control — read and drive a device's GPIO pins from the device page, over
// the MQTT gateway control plane. Served by the ESP32 `gpio_control` firmware app.
export const gpioControlFeature = defineFeature('gpio-control');
