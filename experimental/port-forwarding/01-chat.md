Target architecture

You are essentially building a cloud-managed out-of-band / in-band edge device management plane for Linux SBCs.

The right mental model:

Browser UI
   |
   | HTTPS / WebSocket
   v
Cloud App / API Gateway
   |
   | authz, audit, session broker, tunnel routing
   v
Device Gateway / Broker
   |
   | mTLS, MQTT/WebSocket/QUIC/TCP tunnel
   v
Edge Agent on Jetson / SBC
   |
   +-- shell PTY
   +-- local port proxy
   +-- KVM service
   +-- UART bridge
   +-- device health / telemetry

You already have MQTTs tunneling, which is good for control-plane messages and lightweight request/response workflows. MQTT is a lightweight publish/subscribe protocol designed for IoT and machine-to-machine environments.  

But for the features you listed, some streams are better treated as interactive byte streams, not normal MQTT messages:

Feature	Best transport model
Shell access	WebSocket ↔ PTY byte stream
Website port access	Per-session TCP/WebSocket tunnel
Remote KVM	WebRTC or WebSocket video/input stream
UART bridge	Raw serial byte stream over TLS/WebSocket/MQTT-binary tunnel
Device commands	MQTT request/response

WebSocket is a natural browser-facing protocol because it gives full-duplex communication over a single TCP connection after an HTTP upgrade handshake.   TLS should be mandatory everywhere; TLS 1.3 is designed to protect against eavesdropping, tampering, and message forgery.  

⸻

1. Core design: split control plane and data plane

Control plane

Use MQTTs for:

device online/offline
heartbeat
capabilities
command authorization
session creation
session termination
audit events
device metadata
config updates

Example topics:

devices/{device_id}/status
devices/{device_id}/commands
devices/{device_id}/commands/{command_id}/reply
devices/{device_id}/sessions
devices/{device_id}/audit

A shell session should not simply mean:

publish "run bash"

It should mean:

cloud: create_shell_session(session_id, user_id, policy)
device: accept_shell_session(session_id)
cloud: open byte stream route
browser: attach to session_id over WebSocket

Data plane

Use separate short-lived streams for:

shell bytes
TCP port bytes
UART bytes
KVM video frames
KVM input events
file transfer

This gives you better backpressure, observability, and isolation.

The critical design choice: all inbound connectivity should be outbound from the device.

The device should maintain an outbound mTLS connection to your cloud. Do not require opening SSH/VNC/HTTP ports on the customer network.

⸻

2. Device identity and enrollment

Every device needs a strong identity.

Recommended model

At manufacturing/provisioning time:

device_id
device certificate
private key
tenant binding
hardware serial / TPM identity if available
agent version
allowed capabilities

The agent connects using mutual TLS:

device -> cloud: client cert proves device identity
cloud -> device: server cert proves cloud identity

Then your cloud maps:

cert fingerprint / SPIFFE-like ID -> tenant -> device -> policy

Do not rely only on MQTT username/password for this system. For shell, KVM, UART, and port access, the blast radius is too high.

Device certificate rotation

Support:

initial bootstrap cert
short-lived operational cert
revocation
rotation
lost-device disable
tenant transfer

The cloud should be able to say:

device X is revoked
device X can no longer start management sessions
device X must rotate cert before next privileged operation

⸻

3. Authorization model

Your UI auth system should authorize sessions, not just devices.

A good object model:

User
Tenant
Device
Role
Capability
Session
Policy
AuditEvent

Example capabilities:

device.shell.readonly
device.shell.root
device.port.forward
device.kvm.view
device.kvm.control
device.uart.read
device.uart.write
device.power.reboot
device.file.upload
device.file.download

Shell and UART should be separately authorized. UART can bypass the Linux OS and expose bootloader/root console access, so it is closer to out-of-band privileged access than normal app debugging.

Session object

Every interactive access should create a session record:

{
  "session_id": "sess_123",
  "tenant_id": "tenant_abc",
  "device_id": "dev_jetson_01",
  "user_id": "user_42",
  "type": "shell",
  "capabilities": ["device.shell.root"],
  "expires_at": "...",
  "approved_by": "...",
  "recording_enabled": true,
  "reason": "debug camera pipeline"
}

The edge device should receive a signed session token with:

session_id
device_id
tenant_id
capability
expiry
nonce
cloud signature

The agent validates the token before attaching any PTY, local port, UART, or KVM resource.

⸻

4. Shell access from your UI

Recommended implementation

On the device agent:

cloud session request
    -> agent validates signed token
    -> agent forks PTY
    -> runs restricted shell / login shell / command wrapper
    -> streams PTY bytes to cloud
    -> browser uses xterm.js-style terminal UI

Flow:

Browser xterm.js
   |
   | WebSocket
   v
Cloud session gateway
   |
   | mTLS stream / tunnel
   v
Device agent
   |
   | forkpty()
   v
/bin/bash or restricted command

Go implementation primitives

In Go, you would typically use:

os/exec
github.com/creack/pty
WebSocket library
context cancellation
seccomp / namespaces optionally

Pseudo-flow:

cmd := exec.Command("/bin/bash", "-l")
ptmx, err := pty.Start(cmd)
// stream browser -> ptmx
// stream ptmx -> browser
// resize PTY on browser resize
// kill process when session closes

Python implementation primitives

pty
subprocess
asyncio
websockets
os.setsid
signal handling

Security recommendations

Do not expose the device’s real SSH daemon directly.

Better:

UI shell -> cloud gateway -> device agent -> controlled PTY

This lets you enforce:

SSO
RBAC
MFA
session expiry
audit logging
command recording
tenant isolation
emergency disable

Shell modes

You should support multiple shell levels:

Mode	Behavior
Diagnostic shell	Limited commands only
User shell	Runs as non-root service user
Root shell	Requires privileged permission + MFA
Break-glass shell	Requires approval + full recording

For production fleets, I would make diagnostic shell the default and root shell an exceptional path.

⸻

5. Accessing website ports through your UI

This is local port forwarding through your cloud.

Example use case:

Device has local service:
http://127.0.0.1:8080
User opens:
https://app.example.com/devices/dev123/ports/8080

Your cloud creates:

browser HTTPS request
   -> cloud reverse proxy
   -> session tunnel
   -> device agent connects to 127.0.0.1:8080
   -> response streamed back

Recommended design

Do not expose arbitrary ports by default.

Use a policy:

{
  "allowed_ports": [
    {"name": "app", "host": "127.0.0.1", "port": 8080, "protocol": "http"},
    {"name": "grafana", "host": "127.0.0.1", "port": 3000, "protocol": "http"}
  ]
}

Avoid letting users type:

host=169.254.169.254
host=internal.corp
host=192.168.0.1

Otherwise your device agent becomes an SSRF pivot into customer networks.

Two patterns

Pattern A: HTTP-aware reverse proxy

Best for web UIs.

Browser HTTPS
  -> Cloud HTTP reverse proxy
  -> Device tunnel
  -> Local HTTP service

Pros:

good browser integration
auth cookies stay at cloud
can inject headers
can enforce CSP
can log requests

Cons:

WebSocket upgrade support needed
absolute URLs may break
some apps assume root path

Pattern B: Raw TCP tunnel

Best for arbitrary protocols.

Browser cannot directly do raw TCP

So you need either:

cloud-side TCP listener
browser-side WebSocket adapter
custom web client

For browser UI, HTTP-aware proxy is usually better.

Important browser security controls

For proxied websites, isolate them:

unique subdomain per session or device
short-lived URL
strict SameSite cookies
Content-Security-Policy
no ambient tenant cookies forwarded to device app
disable credential leakage
strip dangerous headers

Prefer:

https://sess-abc123.ports.example.com/

over:

https://app.example.com/device/dev123/proxy/8080/

Subdomains give better origin isolation.

⸻

6. Remote KVM access through your UI

There are three different things people call “KVM.”

Type 1: OS-level remote desktop

This is VNC/RDP-like.

Linux desktop session
   -> VNC server / Wayland capture / X11 capture
   -> cloud
   -> browser

Apache Guacamole is a well-known browser-based remote desktop gateway supporting protocols such as SSH, VNC, and RDP.  

Pros:

easy to implement
works after OS boots
good for desktop Linux

Cons:

does not show bootloader
does not show kernel boot if graphics stack is down
requires OS cooperation

Type 2: True out-of-band KVM

This means:

HDMI capture from SBC
USB HID injection to SBC
optional power control

Architecture:

SBC HDMI out
   -> HDMI capture device
   -> management microcontroller / companion board
   -> cloud video stream
cloud keyboard/mouse events
   -> companion board
   -> USB HID gadget
   -> SBC USB input

This is how PiKVM-style systems work conceptually.

Pros:

works during BIOS/bootloader/kernel boot
works when OS is broken
real recovery path

Cons:

extra hardware
video encoding load
latency concerns
security-critical
more expensive BOM

Type 3: Serial console as “poor man’s KVM”

For Linux edge devices, UART is often more valuable than graphical KVM.

UART console
   -> bootloader logs
   -> kernel logs
   -> login console

Pros:

cheap
works early in boot
excellent for debugging
low bandwidth

Cons:

text-only
requires serial console enabled
can expose root/login prompt

For Jetson Nano-class devices, I would prioritize:

1. UART console
2. shell
3. port forwarding
4. optional graphical remote desktop
5. true HDMI/HID KVM only for premium hardware SKUs

⸻

7. UART via ESP32 / external USB device

This is a strong idea, but it is security-sensitive.

You are describing:

SBC UART TX/RX/GND
   <-> ESP32 UART pins
ESP32 Wi-Fi / USB / Ethernet
   <-> Cloud
Browser UI
   <-> Cloud

This gives boot-time visibility because the ESP32 is independent of the Linux OS.

Important electrical detail

Most SBC UARTs are 3.3V TTL UART, not RS-232 voltage levels.

You need:

GND shared
TX -> RX
RX -> TX
correct voltage level
optional level shifter
ESD protection
baud rate config

Common UART settings:

115200 8N1

Jetson boards often expose serial console through debug headers or USB serial depending on model/carrier board.

ESP32 firmware architecture

ESP32 boots
connects to Wi-Fi / Ethernet
opens mTLS connection to cloud
registers as uart-bridge for device_id
waits for authorized session
streams UART bytes bidirectionally

Session flow:

Browser terminal
   -> WebSocket
   -> cloud UART gateway
   -> ESP32 mTLS stream
   -> UART pins
   -> SBC bootloader/kernel/login console

Do not make ESP32 blindly stream UART forever

Better:

ESP32 always connected for control
UART streaming only during authorized session
read-only mode supported
write mode separately authorized
session timeout
recording/audit enabled

Why? Because UART may expose:

bootloader prompt
kernel boot args
root shell
secrets accidentally printed during boot
device serial numbers
recovery menus

UART modes

Mode	Behavior
Read-only UART	User can observe boot logs
Interactive UART	User can type into console
Bootloader access	User can interrupt boot
Recovery mode	User can rewrite env / boot args

These should be distinct permissions.

ESP32 security model

The ESP32 should have its own identity, not reuse the Linux device identity.

linux_agent_identity = dev123-os
uart_bridge_identity = dev123-oob

Why? Because if Linux is compromised, you do not want the Linux OS to automatically own the out-of-band controller.

For stronger isolation:

ESP32 private key stored in secure element if possible
firmware signed
OTA updates signed
cloud certificate pinning or strict CA validation
rate limits
physical pairing step

⸻

8. Recommended transport choices

Browser to cloud

Use:

HTTPS
WebSocket
WebRTC for video-heavy KVM

WebSocket is the simplest for shell, UART, and port access because browsers natively support it and it provides bidirectional communication.  

Cloud to device

You have several options:

Option	Good for	Comment
MQTT over TLS	Control plane	Great for commands/status
WebSocket over mTLS	Interactive streams	Simple and firewall-friendly
QUIC	Multiplexed streams	Powerful but more complex
WireGuard-like overlay	Network-level access	Strong, but harder to integrate per-session browser auth
SSH reverse tunnel	Quick prototype	Less ideal for productized auth/audit

My recommendation:

MQTTs = control plane
WebSocket/mTLS = data streams
WebRTC = KVM video where needed

Do not force everything through MQTT topics unless you absolutely must. MQTT can carry binary payloads, but terminal, TCP, UART, and video streams need careful handling of ordering, backpressure, flow control, and session lifecycle.

⸻

9. Edge agent structure

On the device:

edge-agent
 ├── identity manager
 ├── mqtt control client
 ├── session manager
 ├── shell service
 ├── port proxy service
 ├── file service
 ├── kvm adapter
 ├── uart adapter
 ├── audit logger
 └── policy cache

Linux privileges

Do not run the whole agent as root unless necessary.

Better:

edge-agent runs as unprivileged user
privileged helper handles narrow operations
sudoers rules are explicit
Linux capabilities instead of full root where possible

Example split:

edge-agent          unprivileged
edge-agent-helper   root, tiny API surface

The helper can perform:

open PTY as target user
read selected logs
restart selected services
reboot device
configure network

Use a Unix socket between them:

/run/edge-agent/helper.sock

Then authorize every helper operation.

⸻

10. Audit and session recording

For this product category, audit is not optional.

Record:

who accessed device
when
from where
which capability
session duration
commands typed
terminal output
files transferred
ports opened
UART input/output
KVM control events

For shell, you can record:

PTY input stream
PTY output stream
terminal resize events
exit code

For UART:

RX bytes
TX bytes
baud rate
session mode
boot interruption events

For port forwarding:

target port
target host
HTTP method/path/status if HTTP-aware
bytes transferred
duration

Be careful with secrets. Give tenants controls for:

record full content
record metadata only
mask known secret patterns
disable recording for sensitive sessions

⸻

11. A safe session lifecycle

A robust lifecycle looks like this:

1. User clicks "Open Shell"
2. Cloud checks RBAC/MFA/policy
3. Cloud creates session_id
4. Cloud sends signed session offer to device over MQTT
5. Device validates offer
6. Device opens outbound data stream to cloud session gateway
7. Browser attaches over WebSocket
8. Cloud relays bytes
9. Device enforces idle timeout/max duration
10. Cloud closes session
11. Audit record is finalized

Important: the device should not trust the browser directly. It should only trust cloud-signed session grants.

⸻

12. Threat model

You are creating a privileged management system. Threats include:

stolen user session
compromised cloud account
compromised device agent
compromised broker
tenant isolation failure
replay attack
rogue device impersonation
malicious insider opening shell
SSRF through port forwarding
UART exposing bootloader/root access
KVM leaking sensitive screen data

Controls

Threat	Control
Stolen browser session	MFA, short session expiry, re-auth for privileged ops
Rogue device	mTLS device certificates
Replay	signed nonce + expiry
Broker compromise	message-level signed session grants
SSRF via port tunnel	allowlist host/port, block LAN ranges unless explicitly allowed
Root misuse	RBAC, approval workflow, recording
UART abuse	read/write split, bootloader permission split
Tenant escape	strict tenant scoping in every session token
Long-lived access	idle timeout, max session duration
Agent compromise	least privilege, separate OOB identity

⸻

13. Feature-by-feature recommendation

Shell access

Build this first.

Minimum viable secure version:

browser xterm.js
cloud WebSocket session gateway
device agent forkpty
mTLS device connection
RBAC + audit

Start with:

non-root diagnostic shell
session timeout
full recording

Then add root/break-glass.

⸻

Website port access

Build second.

Minimum viable secure version:

cloud reverse proxy
per-device/session tunnel
only allow configured local ports
unique per-session URL
short-lived access token

Example UI:

Device -> Services -> Open localhost:8080

Avoid arbitrary destination entry in v1.

⸻

UART bridge

Build third, but design it carefully from day one.

Recommended hardware model:

ESP32-S3 or similar
UART to SBC debug header
independent power if possible
mTLS to cloud
signed firmware
session-based UART streaming

Recommended permissions:

uart.view_boot_logs
uart.interactive_console
uart.interrupt_boot
uart.recovery_write

This distinction matters a lot.

⸻

Remote KVM

Decide which KVM you mean.

For most Linux edge AI devices:

UART + shell + port forwarding

will solve 80–90% of operational needs.

For graphical workloads:

VNC/Wayland capture through agent

For true recovery-grade KVM:

external HDMI capture + USB HID controller

That is a hardware product, not just software.

⸻

14. Suggested concrete stack

Cloud

API service: Go
Session gateway: Go
MQTT broker: EMQX / HiveMQ / Mosquitto / managed broker
Reverse proxy: Envoy / NGINX / custom Go proxy
DB: Postgres
Audit/event log: Kafka/NATS/Postgres depending scale
Object storage: session recordings

Browser

xterm.js for shell/UART
WebSocket client
iframe/subdomain for port proxy
WebRTC player for KVM video

Device agent

Go agent
paho MQTT or native MQTT client
gorilla/websocket / nhooyr websocket
creack/pty
systemd service
Unix socket privileged helper

ESP32 UART bridge

ESP-IDF
mbedTLS
UART driver
ring buffers
cloud mTLS client
OTA updater
watchdog

⸻

15. MVP sequence I would build

Phase 1: Secure foundation

device identity
mTLS connection
MQTT control plane
session objects
RBAC
audit log
agent auto-update

Phase 2: Shell

PTY shell
browser terminal
session recording
resize support
idle timeout
non-root mode

Phase 3: Local web port access

configured service registry
cloud reverse proxy
per-session URL
HTTP/WebSocket support
origin isolation

Phase 4: UART bridge

ESP32 bridge
read-only boot logs
interactive mode
session recording
write permission split

Phase 5: KVM

OS-level remote desktop first
true HDMI/HID KVM only if required by customer use cases

⸻

16. Key design decisions

My strong recommendations:

1. Do not expose SSH/VNC/HTTP directly. Use outbound device tunnels.
2. Keep MQTT for control, not heavy interactive streaming.
3. Use WebSocket for shell/UART/port byte streams.
4. Use WebRTC or a specialized stream for KVM video.
5. Use per-session authorization, not permanent device access.
6. Make UART read/write/bootloader access separate permissions.
7. Treat ESP32 UART bridge as an out-of-band controller with separate identity.
8. Record and audit all privileged sessions.
9. Use allowlisted local services for port forwarding.
10. Run the Linux agent with least privilege and isolate root operations in a helper.

The most important architectural shift is this:

You are not building "remote shell", "remote port", "remote UART", and "remote KVM" separately.
You are building a secure session broker where each capability is just a different stream type.

That gives you a clean, productizable system that integrates with your cloud auth, tenant model, audit model, and device fleet management.