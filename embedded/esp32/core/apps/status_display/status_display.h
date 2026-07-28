#ifndef STATUS_DISPLAY_H
#define STATUS_DISPLAY_H

#include "esp_err.h"

esp_err_t status_display_start(void);
esp_err_t status_display_set_text(const char *text);

#endif
