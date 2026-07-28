#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

// Durable store-and-forward queue for outbound device events: persisted (FlashDB) before delivery, retried until delivered or expired, cleaned up after a retention window.
// Expiry/retention use the monotonic clock (esp_timer) so they work without SNTP and survive wall-clock jumps.

typedef enum {
    HELIX_EVENT_PENDING = 0,
    HELIX_EVENT_SENT = 1,
    HELIX_EVENT_EXPIRED = 2,
} helix_event_status_t;

// One stored event. Mirrors the helix_db `events` table row exactly.
typedef struct {
    int64_t id;
    char msg_id[96];
    char service[48];
    char event_type[48];
    char envelope[256];       // full {type,msgId,timestamp,payload} JSON; kept modest since large FlashDB values trigger slow GC churn under QEMU.
    int64_t created_ms;       // monotonic ms at enqueue
    int64_t expiry_ms;        // monotonic ms deadline (0 = never expire)
    int64_t status;           // helix_event_status_t
    int64_t attempts;
    int64_t last_attempt_ms;  // monotonic ms of last publish attempt
    int64_t sent_ms;          // monotonic ms at delivery (0 = not sent)
    int64_t created_ts;       // wall-clock unix seconds at enqueue (display; 0 if clock invalid)
} helix_event_record_t;

typedef struct {
    int retried;
    int expired;
    int cleaned;
    int pending;
} helix_event_sweep_stats_t;

// Start the queue engine (events table, MQTT PUBACK hook, periodic retry/cleanup task). Requires helix_db ready.
esp_err_t helix_event_queue_init(void);
bool helix_event_queue_ready(void);

// Persist an event as pending with a stable msgId (reused across retries for dedupe); takes ownership of `payload`.
esp_err_t helix_event_queue_enqueue(const char *service, const char *type, cJSON *payload,
                                    uint32_t ttl_sec, int64_t *out_id, char *out_msg_id, size_t msg_id_len);

// Query accessors (used by the events service). `status_filter` < 0 means "any".
int helix_event_queue_count(int status_filter);
int helix_event_queue_list(int status_filter, size_t limit, size_t offset,
                           helix_event_record_t *out, size_t max_rows);
esp_err_t helix_event_queue_get(int64_t id, helix_event_record_t *out);

// Run one retry+expiry+cleanup pass immediately (also driven periodically).
esp_err_t helix_event_queue_sweep(helix_event_sweep_stats_t *out);

// Test hook (CONFIG_HELIX_EVENTS_TEST_HOOKS): mark an event delivered by id, as if the broker acked it.
esp_err_t helix_event_queue_simulate_delivery(int64_t id);

// Delete all stored events. Returns the number removed (negative on error).
int helix_event_queue_clear(void);
