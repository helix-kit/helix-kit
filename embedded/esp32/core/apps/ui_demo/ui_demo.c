#include "ui_demo.h"

#include "helix_ui_esp32.h"
#include "helix_ui_screens.h"

// The whole app: pick a shared screen and hand it to the UI port. Everything
// else -- LVGL, the display driver, the `ui` service, input -- is infrastructure.
esp_err_t ui_demo_start(void)
{
    return helix_ui_esp32_start(helix_ui_screen_hello);
}
