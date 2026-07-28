#pragma once

// A screen builds its widget tree on LVGL's active screen and returns. It is the
// one piece of a Helix device UI that is meant to be written once and run
// everywhere: it touches only LVGL, never a driver, transport, or OS API, so the
// same screen compiles for ESP32 and for a Linux device.
typedef void (*helix_ui_screen_fn)(void);
