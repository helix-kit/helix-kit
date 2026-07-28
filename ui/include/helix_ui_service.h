#pragma once

#include "esp_err.h"

// Registers the `ui` service (info/refresh/pointer); display pixels travel the binary side-channel instead.
esp_err_t helix_ui_service_register(void);
