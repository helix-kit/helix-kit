# Helix device UI

A device UI written once and run anywhere Helix runs. Screens are pure LVGL — no
driver, OS or transport calls — so the same source renders on an ESP32 panel, in
the QEMU emulator, and (next) on a Linux device.

```
include/helix_ui_display.h   the display seam: init + flush(rect, RGB565)
include/helix_ui.h           LVGL wiring; owns no task and no clock
screens/                     the UI itself (helix_ui_screen_fn)
src/helix_ui_display_stream.c  a display driver that ships rectangles to a host
src/helix_ui_service.c       the `ui` service: info / refresh / pointer
port/esp32/                  FreeRTOS task, esp_timer clock, binary side-channel sink
contracts/ui.json            the service contract (generated bindings in generated/)
```

Adding a display means implementing `helix_ui_display_t`; adding a platform means
adding a `port/`. Neither touches a screen.

## Try it

```sh
helix ui build                  # firmware: the ui_demo app + LVGL, for QEMU
helix ui sim                    # boot in QEMU, open the screen in a window
helix ui shot --out shot.png    # headless capture (--tap to click the button first)
```

The UI stack is opt-in: ESP-IDF compiles every component it can see, so `ui/` only
joins a build that asks for the `ui` feature (apps declare this in
`embedded/esp32/core/apps/manifest.json`). See `docs/16-Device-UI-LVGL.md` for the
design, the wire format, and why the flag travels in the environment.
