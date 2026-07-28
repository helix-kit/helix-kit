#pragma once

#include "esp_err.h"
#include "helix_ui_screen.h"

// ESP32 port of the Helix UI core: supplies the millisecond clock, runs LVGL on
// its own FreeRTOS task, registers the `ui` service, and streams flushed
// rectangles out over whichever attached transport carries a binary
// side-channel. The caller supplies only the screen.
esp_err_t helix_ui_esp32_start(helix_ui_screen_fn screen);
