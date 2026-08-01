# @helix/device-apps

Device apps: self-contained UI surfaces mounted at `/device/[id]/[slug]` in the
Helix web app. Each app declares a route slug, a title, and the device feature
flags it needs — a flat `requiredFeatures` list (AND), plus `optionalFeatures`
that never gate visibility, or a full `isAvailable(features)` callback for
arbitrary AND/OR logic over the device's resolved features.

The consuming app imports the app definitions and composes them into its own
registry (see `web/apps/helix/src/device-apps`). The first app is the ESP32
flashing utility (`esp32FlasherApp`), built on `@helix/device-apps/esp32-flasher`.
