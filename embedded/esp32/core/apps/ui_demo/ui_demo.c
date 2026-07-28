#include "ui_demo.h"

#include "helix_ui_esp32.h"
#include "helix_ui_screens.h"

esp_err_t ui_demo_start(void)
{
    return helix_ui_esp32_start(helix_ui_screen_hello);
}
