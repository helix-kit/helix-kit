#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

// Pointer input queue. Producers (the `ui` service handler, running on whichever
// task the transport dispatches from) push events; the UI task drains them from
// LVGL's input-device read callback. Single-producer/single-consumer, lock-free,
// so it needs no RTOS primitives and stays portable across ESP32 and Linux.

typedef struct {
    uint16_t x;
    uint16_t y;
    bool pressed;
} helix_ui_pointer_t;

// ESP_ERR_NO_MEM when the queue is full: the host is clicking faster than the UI
// task can render, and dropping the event is better than blocking the caller.
esp_err_t helix_ui_input_push_pointer(const helix_ui_pointer_t *event);

bool helix_ui_input_pop_pointer(helix_ui_pointer_t *out);

bool helix_ui_input_pending(void);
