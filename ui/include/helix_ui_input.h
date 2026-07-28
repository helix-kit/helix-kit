#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

// Pointer input queue: single-producer/single-consumer, lock-free, so it needs no RTOS primitives.

typedef struct {
    uint16_t x;
    uint16_t y;
    bool pressed;
} helix_ui_pointer_t;

// Returns ESP_ERR_NO_MEM when the queue is full (drops the event rather than block).
esp_err_t helix_ui_input_push_pointer(const helix_ui_pointer_t *event);

bool helix_ui_input_pop_pointer(helix_ui_pointer_t *out);

bool helix_ui_input_pending(void);
