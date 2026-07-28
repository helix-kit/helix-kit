# Helix Remote Shell (experimental)

A browser-based PTY shell into a Linux device, served at **helix-kit.com**. Open
the page and you get a real interactive terminal (xterm.js) wired to a login
shell (`forkpty` → `/bin/bash`) running on the device — the device exposes
**zero inbound ports**.

> ⚠️ **Experimental, NO AUTH.** Anyone who can reach the UI gets a shell on the
> connected device. Run the agent only inside a throwaway container. Auth,
> device identity, RBAC, per-session grants, recording — all deferred (see
> `../port-forwarding/01-chat.md` §4/§10 for the intended model).

## Architecture

```
  Browser (xterm.js React UI)
    │  WSS  wss://helix-kit.com/__shell_ws__   (stdin binary / resize JSON)
    ▼
  Caddy on EC2  (TLS)
    ▼
  shell-gateway (Node/TS)   serves the UI + relays PTY, one agent (MVP)
    │  one persistent WS per agent, binary-framed, multiplexed by stream id
    ▼  (agent dials OUT: wss://helix-kit.com/__shell_agent__)
  shell-agent (Go) on device
    │  pty.Start(/bin/bash -l), Setsize on resize
    ▼
  interactive shell
```

Each browser tab = one stream = one PTY. Keystrokes travel as binary `DATA`
frames; terminal resizes as JSON `RESIZE`; PTY output streams back as `DATA`;
shell exit sends `EXIT`.

## Wire protocol (agent ↔ gateway)

Binary frames `[type:1][streamId:4][payload]`, identical in
`gateway/src/protocol.ts` and `agent/protocol.go`:

| Type          | Dir        | Payload                    |
|---------------|------------|----------------------------|
| `REGISTER`    | agent → gw | JSON `{agentId}`           |
| `REGISTER_ACK`| gw → agent | JSON `{ok}`                |
| `OPEN`        | gw → agent | JSON `{cols, rows}`        |
| `DATA`        | either     | raw PTY bytes              |
| `RESIZE`      | gw → agent | JSON `{cols, rows}`        |
| `CLOSE`       | either     | —                          |
| `EXIT`        | agent → gw | JSON `{code}`              |

Browser ↔ gateway WS: binary messages = stdin; text messages = JSON control
(`resize`); gateway → browser binary = PTY output, text = `{type:exit|error}`.

## Layout

```
ui/        React + xterm.js terminal (Vite build → static)
gateway/   Node + TS: serves the built UI + PTY relay WebSockets
agent/     Go device agent (creack/pty)
Dockerfile multi-stage: build ui/ → serve from gateway  (build context = this dir)
```

## Run the device side (container shell)

The agent's own container is the "device"; the browser shell lands inside it.

```bash
# from experimental/remote-shell/agent/
docker build -t helix-shell-agent .
docker run -d --name helix-shell-agent helix-shell-agent
# → open https://helix-kit.com/
```

Env / flags: `GATEWAY_URL` (default `wss://helix-kit.com/__shell_agent__`),
`AGENT_ID`, `SHELL_BIN` (default `/bin/bash`).

## Deploy the gateway

The gateway is deployed by the shared `../deploy/` compose (Caddy routes
`helix-kit.com` → `shell-gateway:9100`). See `../deploy/`.

## Session lifecycle / liveness

Closing a tab tears down its PTY: the browser socket closes → gateway sends
`CLOSE` → agent kills the shell. Clean closes and TCP resets are detected
instantly. For a **silent** disconnect (laptop sleep, Wi-Fi/route drop,
backgrounded tab, or a browser that never sent a close frame) there is no
FIN/RST, so the gateway runs a ping/pong heartbeat on both the browser socket
(15 s) and the agent socket (20 s): a peer that misses a full interval is
terminated, which reaps the PTY within ~15–30 s. Browsers auto-reply to
protocol pings, so no client change is needed. If the agent's link to the
gateway drops entirely, the agent kills every PTY it owns on reconnect.

## Appearance controls

The header has Cockpit-style controls: a **font size** stepper (−/+, 8–30px),
an **Appearance** dropdown (Black / Dark / Light / White, each with a matching
GitHub-style ANSI palette so TUIs stay legible), and **Reset**. Font-size
changes refit the terminal (and resize the PTY); the terminal-wrap background
follows the theme so there's no mismatched border. Both settings persist in
`localStorage` (`helix.fontSize`, `helix.theme`).

## Header bandwidth readout

The UI header shows live per-session usage, counted **client-side** (the browser
sees every byte of its own session, so it's exact and needs no server calls):
`↓` PTY output received, `↑` keystrokes sent, current throughput, and
`egress≈` the estimated EC2 billable egress (`×1.065`). The tooltip adds the
total and the instance-NIC estimate (`×2.13`). Factors come from
`../bandwidth/` measurements.

## Scrollbar

The xterm scrollback scrollbar is styled thin/themed and pinned to the window's
right edge: the `.terminal-wrap` has **no right padding** (so the bar isn't inset
from the edge) and the viewport uses `scrollbar-gutter: stable` with a fixed
10px `::-webkit-scrollbar` width, so full-width TUI lines (top/htop) reserve a
consistent lane and don't render under the bar. (A prior `padding: 8px 10px`
inset the scrollbar ~10px from the edge and let content overlap it.)

## Notes

- **Fullscreen layout must not scroll the page.** The UI containers
  (`html/body/#root/.app/.terminal-wrap`) are `overflow: hidden` and the fit is
  `requestAnimationFrame`-debounced. Without this, on a large window with real
  (classic, layout-consuming) scrollbars, the xterm viewport's reserved
  scrollbar overflows the un-clipped wrap → a document scrollbar appears →
  FitAddon re-measures a smaller viewport → refit → the overflow toggles back →
  the terminal flickers/resizes continuously (worst with alt-screen TUIs like
  btop). Headless Chromium can't reproduce it (0px overlay scrollbars), so this
  was diagnosed from computed styles and verified by proving the page can no
  longer scroll even with forced 15px scrollbars.


- The device image installs **full `vim`**, not `vim-tiny`: vim-tiny's stripped
  redraw defers the insert-mode backspace erase, leaving ghost characters on
  screen (gone from the buffer, cleared only on the next redraw/Esc). Full vim
  emits the erase per keystroke and renders correctly through the tunnel. This
  was a vim-tiny quirk, not a terminal/tunnel bug — the exact erase sequence
  (`ESC[<col>H ESC[K`) verifies correctly through xterm.js in isolation.

## Known limitations (MVP)

- No auth; single connected agent (last registration wins).
- No session recording / audit.
- Shell runs as the agent container's user (root here); no privilege split.
