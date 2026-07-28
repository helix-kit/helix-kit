#include "helix_fs_sink.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"

#include "helix_storage.h"

static const char *TAG = "helix_fs_sink";

typedef struct {
    helix_xfer_sink_t base;
    FILE *fp;
    uint32_t pos;
    char path[256];
} fs_sink_t;

static fs_sink_t *as_fs(helix_xfer_sink_t *self)
{
    return (fs_sink_t *)self;
}

static esp_err_t fs_write(helix_xfer_sink_t *self, uint32_t offset, const uint8_t *data, size_t len)
{
    fs_sink_t *sink = as_fs(self);
    if (sink->fp == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (offset != sink->pos) {
        if (fseek(sink->fp, (long)offset, SEEK_SET) != 0) {
            ESP_LOGE(TAG, "seek to %u failed for %s", (unsigned)offset, sink->path);
            return ESP_FAIL;
        }
        sink->pos = offset;
    }
    if (len > 0 && fwrite(data, 1, len, sink->fp) != len) {
        ESP_LOGE(TAG, "write of %u bytes failed for %s", (unsigned)len, sink->path);
        return ESP_FAIL;
    }
    sink->pos += (uint32_t)len;
    return ESP_OK;
}

static esp_err_t fs_commit(helix_xfer_sink_t *self)
{
    fs_sink_t *sink = as_fs(self);
    if (sink->fp == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (fflush(sink->fp) != 0 || fclose(sink->fp) != 0) {
        sink->fp = NULL;
        ESP_LOGE(TAG, "commit (close) failed for %s", sink->path);
        return ESP_FAIL;
    }
    sink->fp = NULL;
    ESP_LOGI(TAG, "committed %u bytes to %s", (unsigned)sink->pos, sink->path);
    return ESP_OK;
}

static void fs_abort(helix_xfer_sink_t *self)
{
    fs_sink_t *sink = as_fs(self);
    if (sink->fp != NULL) {
        fclose(sink->fp);
        sink->fp = NULL;
    }
    if (sink->path[0] != '\0') {
        remove(sink->path);
    }
}

static void fs_destroy(helix_xfer_sink_t *self)
{
    fs_sink_t *sink = as_fs(self);
    if (sink->fp != NULL) {
        fclose(sink->fp);
    }
    free(sink);
}

helix_xfer_sink_t *helix_fs_sink_open(const char *relpath, size_t total_size, esp_err_t *err_out)
{
    (void)total_size;
    esp_err_t err = ESP_OK;
    helix_xfer_sink_t *result = NULL;

    const char *mount = helix_storage_mount_point();
    if (mount == NULL) {
        ESP_LOGE(TAG, "storage not mounted; cannot open %s", relpath ? relpath : "(null)");
        err = ESP_ERR_INVALID_STATE;
        goto done;
    }
    if (relpath == NULL || relpath[0] == '\0') {
        err = ESP_ERR_INVALID_ARG;
        goto done;
    }
    while (*relpath == '/') {
        relpath++;
    }

    fs_sink_t *sink = calloc(1, sizeof(fs_sink_t));
    if (sink == NULL) {
        err = ESP_ERR_NO_MEM;
        goto done;
    }
    sink->base.write = fs_write;
    sink->base.commit = fs_commit;
    sink->base.abort = fs_abort;
    sink->base.destroy = fs_destroy;

    if (snprintf(sink->path, sizeof(sink->path), "%s/%s", mount, relpath) >= (int)sizeof(sink->path)) {
        ESP_LOGE(TAG, "path too long: %s/%s", mount, relpath);
        free(sink);
        err = ESP_ERR_INVALID_SIZE;
        goto done;
    }

    sink->fp = fopen(sink->path, "wb");
    if (sink->fp == NULL) {
        ESP_LOGE(TAG, "fopen failed for %s", sink->path);
        free(sink);
        err = ESP_FAIL;
        goto done;
    }

    ESP_LOGI(TAG, "opened fs sink %s", sink->path);
    result = &sink->base;

done:
    if (err_out != NULL) {
        *err_out = result != NULL ? ESP_OK : err;
    }
    return result;
}
