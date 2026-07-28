#include "helix_xfer_sink.h"

#include <string.h>

#include "esp_log.h"

#include "helix_fs_sink.h"

static const char *TAG = "helix_xfer_sink";

// Match "scheme:" at the start of dest; returns the remainder after the colon,
// or NULL if `dest` doesn't start with the given scheme.
static const char *match_scheme(const char *dest, const char *scheme)
{
    size_t n = strlen(scheme);
    if (strncmp(dest, scheme, n) == 0 && dest[n] == ':') {
        return dest + n + 1;
    }
    return NULL;
}

helix_xfer_sink_t *helix_xfer_sink_open(const char *dest, size_t total_size, esp_err_t *err_out)
{
    if (dest == NULL || dest[0] == '\0') {
        if (err_out != NULL) {
            *err_out = ESP_ERR_INVALID_ARG;
        }
        return NULL;
    }

    const char *rest = match_scheme(dest, "fs");
    if (rest != NULL) {
        return helix_fs_sink_open(rest, total_size, err_out);
    }

    // Future: match_scheme(dest, "ota") -> helix_ota_sink_open(...)

    ESP_LOGE(TAG, "unsupported transfer destination: %s", dest);
    if (err_out != NULL) {
        *err_out = ESP_ERR_NOT_SUPPORTED;
    }
    return NULL;
}
