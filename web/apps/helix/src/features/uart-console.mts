import { defineFeature } from '@helix-hq/backend/features';

// UART console (experimental) — a browser terminal to a target device's serial
// console via an ESP32 `console` bridge, over the same HelixStream data plane as
// the Linux shell. Declared here for now; moves beside the app when that lands.
export const uartConsoleFeature = defineFeature('uart-console');
