#ifndef CONSOLE_BRIDGE_APP_H
#define CONSOLE_BRIDGE_APP_H

#include "esp_err.h"

// Registers the `console` service: bridges a target's serial console (on a spare UART) to the Helix protocol; target bytes stream out as `console-data`, host keystrokes arrive via `write`.
esp_err_t console_bridge_start(void);

#endif  // CONSOLE_BRIDGE_APP_H
