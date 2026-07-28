#pragma once

// Builds its widget tree on LVGL's active screen and returns; touches only LVGL, so it runs everywhere.
typedef void (*helix_ui_screen_fn)(void);
