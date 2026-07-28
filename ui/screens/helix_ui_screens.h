#pragma once

#include "helix_ui_screen.h"

// Shared Helix screens. Each is a helix_ui_screen_fn: pure LVGL, no driver, OS,
// or transport calls, so the same source renders on an ESP32 panel, in the QEMU
// stream viewer, and on a Linux device.
void helix_ui_screen_hello(void);
