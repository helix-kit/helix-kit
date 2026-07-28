#pragma once

#include "esp_err.h"
#include "helix_ui_screen.h"

// ESP32 port: runs LVGL on a FreeRTOS task, registers the `ui` service, streams rectangles out. Caller supplies only the screen.
esp_err_t helix_ui_esp32_start(helix_ui_screen_fn screen);
