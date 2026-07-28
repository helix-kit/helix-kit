#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

// Durable store-and-forward queue for outbound device events. Every event is
// persisted locally (FlashDB via helix_db) before delivery, tracked for cloud
// delivery (MQTT QoS-1 PUBACK), retried until delivered or expired, and cleaned
// up after a retention window once sent. No-op stubs when CONFIG_HELIX_EVENT_QUEUE
// is disabled.
//
// Timing note: expiry and retention are measured with the monotonic clock
// (esp_timer), so they work without SNTP and never expire early when the wall
// clock jumps. A reboot resets an event's age (safe: it just gets retried a bit
// longer). The wall-clock createdTs is best-effort display only.

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
    char envelope[256];       // full {type,msgId,timestamp,payload} JSON, published verbatim.
                              // Kept modest: large FlashDB values trigger GC churn that is very slow
                              // under QEMU's flash model. Events with bigger payloads are rejected.
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

// Start the queue engine: define the events table, register the MQTT PUBACK hook,
// and start the periodic retry/cleanup task. Requires helix_db to be ready.
esp_err_t helix_event_queue_init(void);
bool helix_event_queue_ready(void);

// Persist an event as pending. Builds the {type,msgId,timestamp,payload} envelope
// and a stable msgId (reused across retries so the server dedupes). ttl_sec == 0
// uses the configured default. Takes ownership of `payload`. Optionally returns
// the new row id and msgId.
esp_err_t helix_event_queue_enqueue(const char *service, const char *type, cJSON *payload,
                                    uint32_t ttl_sec, int64_t *out_id, char *out_msg_id, size_t msg_id_len);

// Query accessors (used by the events service). `status_filter` < 0 means "any".
int helix_event_queue_count(int status_filter);
int helix_event_queue_list(int status_filter, size_t limit, size_t offset,
                           helix_event_record_t *out, size_t max_rows);
esp_err_t helix_event_queue_get(int64_t id, helix_event_record_t *out);

// Run one retry+expiry+cleanup pass immediately (also driven periodically).
esp_err_t helix_event_queue_sweep(helix_event_sweep_stats_t *out);

// Test hook (CONFIG_HELIX_EVENTS_TEST_HOOKS): mark an event delivered by id, as
// if the broker had acked it. Processed on the next sweep, like a real PUBACK.
esp_err_t helix_event_queue_simulate_delivery(int64_t id);

// Delete all stored events. Returns the number removed (negative on error).
int helix_event_queue_clear(void);
