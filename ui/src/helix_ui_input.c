#include "helix_ui_input.h"

#include <stdatomic.h>

#define HELIX_UI_INPUT_QUEUE_LEN 16

static helix_ui_pointer_t s_queue[HELIX_UI_INPUT_QUEUE_LEN];
static atomic_uint_fast32_t s_head;  // producer writes here
static atomic_uint_fast32_t s_tail;  // consumer reads here

esp_err_t helix_ui_input_push_pointer(const helix_ui_pointer_t *event)
{
    if (event == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const uint_fast32_t head = atomic_load_explicit(&s_head, memory_order_relaxed);
    const uint_fast32_t tail = atomic_load_explicit(&s_tail, memory_order_acquire);
    if (head - tail >= HELIX_UI_INPUT_QUEUE_LEN) {
        return ESP_ERR_NO_MEM;
    }
    s_queue[head % HELIX_UI_INPUT_QUEUE_LEN] = *event;
    atomic_store_explicit(&s_head, head + 1, memory_order_release);
    return ESP_OK;
}

bool helix_ui_input_pop_pointer(helix_ui_pointer_t *out)
{
    const uint_fast32_t tail = atomic_load_explicit(&s_tail, memory_order_relaxed);
    const uint_fast32_t head = atomic_load_explicit(&s_head, memory_order_acquire);
    if (head == tail) {
        return false;
    }
    if (out != NULL) {
        *out = s_queue[tail % HELIX_UI_INPUT_QUEUE_LEN];
    }
    atomic_store_explicit(&s_tail, tail + 1, memory_order_release);
    return true;
}

bool helix_ui_input_pending(void)
{
    return atomic_load_explicit(&s_head, memory_order_acquire) !=
           atomic_load_explicit(&s_tail, memory_order_relaxed);
}
