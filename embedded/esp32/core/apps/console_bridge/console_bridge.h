#ifndef CONSOLE_BRIDGE_APP_H
#define CONSOLE_BRIDGE_APP_H

#include "esp_err.h"

// Registers the `console` service: bridges a target device's serial console
// (on a spare hardware UART) to the Helix protocol so it can be driven
// remotely — target-UART bytes are streamed out as `console-data` events and
// host keystrokes arrive via the `write` method. Auto-opens the bridge with
// compile-time defaults; `open`/`config` reconfigure it at runtime.
esp_err_t console_bridge_start(void);

#endif  // CONSOLE_BRIDGE_APP_H
