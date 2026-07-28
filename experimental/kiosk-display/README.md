# Helix Kiosk Display (experimental)

A QEMU-in-a-box kiosk: a Linux VM boots straight into a **fullscreen WebKitGTK
browser** showing a website, and the operator switches between screens with
keyboard keys. This prototype serves a **dummy static React site** from inside
the VM so the whole loop — provision → serve → display → switch — can be
exercised on a laptop with no hardware.

It is ported from a prior production system's qemu-display lab. That lab switched a
GStreamer video feed against a WebKitGTK "edge UI"; here the switching is
web-only: the shell cycles the hash routes of the React site.

## Layout

```
kiosk-display/
├── prepare-kiosk.sh        # build the React site + qcow2 overlay + cloud-init seed
├── run-kiosk.sh            # launch QEMU (calls prepare first)
├── cloud-init/
│   ├── user-data           # provisions the VM: user, X11, WebKitGTK, 9p mount, site service
│   └── meta-data
├── shell/
│   └── kiosk-shell.py      # fullscreen WebKitGTK kiosk + keyboard screen switching
└── site/                   # dummy static React site (Vite + React 19)
```

## How it fits together

1. **`prepare-kiosk.sh`** builds `site/dist` (`npm install && npm run build`),
   downloads the Ubuntu Noble cloud image on first run, creates a qcow2 overlay,
   and builds a cloud-init seed ISO from `cloud-init/`.
2. **`run-kiosk.sh`** boots `qemu-system-x86_64` with a `virtio-vga` GTK display
   window, SSH forwarded to host port `2222`, and the **whole Helix repo shared
   over 9p** (mount tag `helix`) at `/home/helix/helix` in the guest. Because the
   site and the shell are served from that share, you can rebuild the site on the
   host and just restart the shell — no VM image rebuild.
3. **First boot** cloud-init creates the `helix` user (password `helix`),
   installs X11 + openbox + WebKitGTK, enables the 9p mount, and starts
   `helix-kiosk-site.service` — a `python3 -m http.server` serving `site/dist`
   on `127.0.0.1:8080`.
4. **Start the kiosk** from the VM console (or over SSH):

   ```bash
   helix-kiosk-start-x
   ```

   This runs `startx` → `helix-kiosk-lab` → `shell/kiosk-shell.py` fullscreen,
   loading `http://127.0.0.1:8080/#/home`. Started over SSH/serial it uses
   `openvt` to bring the X session up on `tty1`.

## Usage

```bash
# build site + image + seed, then boot with a GTK window
experimental/kiosk-display/run-kiosk.sh

# reprovision from scratch (after editing cloud-init)
experimental/kiosk-display/run-kiosk.sh --fresh

# headless boot with serial on stdio (no GTK window — for provisioning/debug)
experimental/kiosk-display/run-kiosk.sh --stdio

# SSH in (password: helix)
ssh helix@127.0.0.1 -p 2222
```

Other flags: `--skip-site` (don't rebuild the React site), `--no-kvm` (software
emulation with `-cpu max` when `/dev/kvm` is unavailable — much slower).

## Keyboard controls (in the kiosk shell)

| Key | Action |
| --- | --- |
| `1` `2` `3` | jump to screen (Home / Metrics / Info) |
| `n` · `p` (or `→` `←`) | next / previous screen |
| `F5` | reload |
| `q` · `Esc` · `F12` | quit the shell |

## Notes / limits

- Requires `qemu-system-x86_64`, `qemu-img`, `cloud-localds`, and (for the site
  build) `node`/`npm`. KVM (`/dev/kvm`) is used when present.
- The GTK display window needs a graphical host session. On a headless host, use
  `--stdio` to watch provisioning, then SSH in to verify the site service.
- Overlay disk, base image, and seed ISO land in `.lab/` (gitignored). Override
  the location with `HELIX_KIOSK_LAB_ROOT`.
- This is a validation lab, not a shipping image: the React site is a stand-in,
  and provisioning is cloud-init on a stock Ubuntu cloud image rather than the
  purpose-built `linux/platform_os` rootfs.
