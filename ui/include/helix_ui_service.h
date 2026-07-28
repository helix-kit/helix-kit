#pragma once

#include "esp_err.h"

// Registers the `ui` service on the Helix dispatcher: `info` reports the screen
// geometry and pixel format, `refresh` forces a full re-flush, and `pointer`
// injects touch/click input. Display pixels do not travel this way -- they leave
// on the binary side-channel (see helix_ui_display_stream.h).
esp_err_t helix_ui_service_register(void);
