# @helix-hq/firmware-builder

User-facing UI for requesting **custom ESP32 firmware builds**.

This package is presentational: it renders the build-options catalog (apps,
feature fragments, chips, flash sizes, sdkconfig knobs) as a form and reports a
build's live status. It is deliberately decoupled from any backend wiring — the
consuming app passes in the `catalog` and handles the request/poll via its own
tRPC surface (`@helix-hq/backend/releases`).

- `FirmwareBuilderForm` — the build configuration form. Given a `BuildCatalog`,
  it lets a user pick apps, toggle feature fragments (auto-enabling those an app
  requires), choose chip/flash size, set sdkconfig overrides, and name the
  release, then calls `onSubmit` with the assembled values.
- `BuildStatusPanel` — shows a requested build's state (queued → success/failed),
  its duration, resulting release, and any error.

The catalog itself is served by the build container (`GET /catalog`) and proxied
by the backend, so the option lists never drift from what
`helix embedded esp32 link` actually understands. See
`docs/09-Custom-Firmware-Builds.md`.
