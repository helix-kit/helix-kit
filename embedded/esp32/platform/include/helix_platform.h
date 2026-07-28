#pragma once

#include <stdbool.h>

#include "esp_err.h"

esp_err_t helix_platform_init(void);
void helix_platform_wait_forever(void);
void helix_platform_stop_on_error(const char *operation, esp_err_t err);
