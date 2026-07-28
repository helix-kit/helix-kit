Yes. This pattern has been implemented many times, but your version would be differentiated by being device-management-native, tenant/RBAC aware, and session-scoped inside your own cloud app.

The closest existing models are:

Product/system	Similarity to your idea	Key difference
GitHub Codespaces forwarded ports	Very close	Tunnels dev-container ports to browser-accessible URLs. Visibility can be private/org/public.  
VS Code port forwarding / Dev Tunnels	Very close	For dev workflows. VS Code supports local service forwarding and Microsoft Dev Tunnels can create public URLs for local services.  
Cloudflare Tunnel	Very close infra pattern	cloudflared maintains an outbound-only connection, and public hostnames route to private/local services. Cloudflare can apply Access policies before proxying.  
Tailscale Serve/Funnel	Similar	Publishes local services either inside a tailnet or publicly, but identity/routing model is Tailscale-native rather than your app-native.  
ngrok / localtunnel-style products	Similar	Developer-centric public ingress to local services, usually not deeply integrated with your device fleet authorization model.
Apache Guacamole	Related, not identical	Browser gateway for SSH/VNC/RDP, useful analogy for remote interactive access but not exactly ephemeral web-port proxying.

So yes: what you are describing is basically:

Codespaces-style forwarded ports
+ Cloudflare Tunnel-style outbound device connector
+ your own SSO/RBAC/session/audit model
+ temporary per-session subdomains
+ device-local service allowlist

That is a strong design.

⸻

The model you described is exactly the right product shape

Your proposed flow:

User clicks "Open Grafana" / "Open Device App"
        |
        v
Cloud creates temporary tunnel session
        |
        v
Cloud assigns temporary subdomain
        |
        v
Browser opens new tab
        |
        v
Cloud reverse-proxies HTTPS requests
        |
        v
Device agent forwards to localhost:PORT

For example:

https://sess-8f3a9d.devices.yourcloud.com
        |
        v
device dev_123 -> 127.0.0.1:3000

This is much better than asking customers to expose:

:3000 Grafana
:8080 app
:9090 Prometheus
:15672 RabbitMQ
:8288 debug API

Instead, the device exposes zero inbound ports.

⸻

Recommended architecture

Browser
  |
  | HTTPS
  v
Session Subdomain
  |
  | app auth / tunnel token / reverse proxy
  v
Cloud Port Gateway
  |
  | existing outbound device connection
  | WebSocket / HTTP2 / QUIC stream
  v
Edge Agent
  |
  | local TCP connection
  v
127.0.0.1:PORT on device

The cloud gateway acts as a reverse proxy. The edge agent acts like a local connector.

⸻

Session start flow

1. User opens your cloud UI.
2. User clicks "Open Grafana".
3. Cloud checks:
   - user is authenticated
   - user belongs to tenant
   - user has permission for device
   - user has permission for service
   - device is online
4. Cloud creates PortProxySession.
5. Cloud generates temporary hostname.
6. Cloud sends session offer to device agent.
7. Device agent accepts only if the signed session token is valid.
8. Browser opens temporary URL in new tab.
9. Cloud proxies requests to device agent.
10. Device agent connects to 127.0.0.1:3000 and relays bytes.

Example session object:

{
  "session_id": "pps_01HXYZ",
  "tenant_id": "tenant_123",
  "device_id": "device_abc",
  "user_id": "user_789",
  "service": "grafana",
  "target_host": "127.0.0.1",
  "target_port": 3000,
  "scheme": "http",
  "hostname": "pps-01hxyz.edge.example.com",
  "expires_at": "2026-07-08T12:30:00Z",
  "visibility": "private",
  "record_metadata": true
}

⸻

Important design choice: temporary subdomain vs path proxy

Prefer temporary subdomains

Use this:

https://pps-01hxyz.edge.example.com/

Not this:

https://app.example.com/devices/device_abc/proxy/3000/

Temporary subdomains are cleaner because many internal services assume they are mounted at /.

Grafana, Prometheus, dashboards, debug UIs, and random web apps often break when placed under a path prefix unless configured carefully.

Subdomains also give better browser origin isolation.

Design	Pros	Cons
app.example.com/proxy/device/port	Easier routing	Apps break on absolute paths, cookies can collide
session-id.edge.example.com	Better isolation, cleaner app behavior	Needs wildcard DNS/TLS
device-port-tenant.edge.example.com	Human readable	Leaks metadata unless careful

I would use opaque session subdomains:

https://p-7xk92ma4.edge.example.com

Not:

https://grafana-device123-customerA.edge.example.com

Avoid leaking tenant/device/service names in URLs.

⸻

DNS and TLS

Use:

*.ports.yourcloud.com

with a wildcard certificate.

Then every session gets:

https://<random-session-id>.ports.yourcloud.com

You do not need to dynamically create DNS records per session if you use wildcard DNS:

*.ports.example.com -> cloud-port-gateway-lb

Then your gateway resolves the session by Host header:

Host: p-7xk92ma4.ports.example.com

The gateway looks up:

p-7xk92ma4 -> session_id -> device_id -> target_port

⸻

How the cloud-to-device stream should work

For each incoming browser connection, your cloud gateway can open a logical stream to the device agent.

Browser request #1
  -> cloud gateway
  -> stream_id=101 to device
  -> device connects to 127.0.0.1:3000
  -> response relayed back

For HTTP/1.1, this is straightforward.

For WebSockets, support HTTP upgrade:

Browser WebSocket
  -> cloud gateway
  -> device stream
  -> localhost WebSocket service

For SSE/streaming APIs, support long-lived responses.

For HTTP/2 to the browser, your gateway can terminate HTTP/2 and proxy as HTTP/1.1 to the device initially. That is simpler.

⸻

Data-plane protocol options

Option A: WebSocket from device to cloud

Simplest to implement.

device agent -> cloud gateway: persistent WebSocket/mTLS
cloud -> device: open logical stream messages

You implement multiplexing:

{
  "stream_id": "s101",
  "type": "open",
  "target_host": "127.0.0.1",
  "target_port": 3000
}

Then binary frames:

stream_id + payload

Pros:

easy through firewalls
easy in Go/Python
browser-compatible concepts
works with load balancers

Cons:

you must implement flow control/multiplexing carefully
head-of-line blocking if naive

Option B: HTTP/2 or gRPC streams

Good production choice.

device agent -> cloud gateway: long-lived gRPC stream

Pros:

multiplexing
flow control
metadata
mTLS support
good Go support

Cons:

more complex than WebSocket
some proxies/load balancers need tuning

Option C: QUIC

Best long-term stream transport.

Pros:

native multiplexed streams
better behavior under packet loss
modern transport

Cons:

more operational complexity
UDP may be blocked in some customer networks

My recommendation:

v1: WebSocket or gRPC stream
v2: gRPC/HTTP2 if you need cleaner multiplexing
v3: QUIC only if performance/scale demands it

⸻

Critical security controls

This feature can become an SSRF machine if you are not strict.

1. No arbitrary host/port by default

Do not allow:

user enters host=anything, port=anything

Instead define service descriptors:

[
  {
    "id": "grafana",
    "name": "Grafana",
    "target_host": "127.0.0.1",
    "target_port": 3000,
    "scheme": "http",
    "required_permission": "device.service.grafana.view"
  },
  {
    "id": "local-app",
    "name": "Device App",
    "target_host": "127.0.0.1",
    "target_port": 8080,
    "scheme": "http",
    "required_permission": "device.service.local_app.view"
  }
]

The device agent should enforce the allowlist too. Do not rely only on cloud-side checks.

⸻

2. Bind session to user and device

Every request to the temporary subdomain should map to:

session_id
tenant_id
user_id
device_id
service_id
expiry

The cloud gateway should reject if:

session expired
user no longer authenticated
device changed
tenant mismatch
service not allowed
session revoked

⸻

3. Do not forward your app cookies to the device service

The browser will send cookies for:

*.ports.example.com

Do not share the same cookie scope as your main app:

app.example.com

Better:

app.example.com        -> main app
*.ports.example.net    -> tunneled services

Even better, use a separate eTLD+1 if possible:

yourapp.com
yourapp-ports.com

Reason: proxied internal services are not necessarily trustworthy. They may be old Grafana, debug Flask apps, random local admin UIs, etc. Keep them isolated from your primary application origin.

⸻

4. Inject identity headers only if the target service is trusted

You may be tempted to send:

X-User-Email: admin@example.com
X-User-Role: sysadmin
X-Tenant-ID: tenant_123

Be careful. Only inject identity headers for services that are designed to trust your reverse proxy.

For arbitrary local services, avoid identity header injection. Use the proxy only as an access gate.

⸻

5. Strip dangerous headers

At minimum, normalize or strip:

Forwarded
X-Forwarded-For
X-Forwarded-Host
X-Real-IP
Connection
Upgrade
Proxy-Authorization
Authorization, unless intentionally passed
Cookie, depending on mode

For many internal services, you may also want to rewrite:

Host
Origin
Referer
Location response headers
Set-Cookie domain/path

⸻

Handling Grafana specifically

Grafana is a good example.

Grafana may need config such as:

[server]
root_url = https://p-7xk92ma4.ports.example.com/
serve_from_sub_path = false

But for ephemeral per-session hostnames, you may not want to reconfigure Grafana every time.

So your proxy should support:

Host rewrite
WebSocket upgrade
Location header rewrite
Set-Cookie rewrite
absolute URL tolerance

Grafana also uses WebSockets/live features in some cases, so HTTP upgrade support matters.

⸻

Public, private, and shared visibility

Copy this concept from Codespaces-style port forwarding.

Have visibility modes:

private: only the initiating user can access
tenant: users with permission in same tenant can access
public-link: anyone with unguessable URL can access
disabled: not allowed

For your edge AI system, I would default to:

private

and maybe support:

tenant-shared

Avoid public links unless there is a very explicit product need.

GitHub Codespaces has similar visibility concepts for forwarded ports: private, organization, and public depending on policy.  

⸻

Suggested MVP design

Cloud components

Port Session API
Port Gateway
Wildcard DNS + TLS
Session DB
Audit Logger
Device Connection Manager

Device agent components

Control client
Tunnel client
Service allowlist
Local TCP dialer
HTTP/WebSocket relay
Flow-control layer

Browser UX

Device page
  -> Services
     -> Grafana [Open]
     -> App UI [Open]
     -> Prometheus [Open]

Clicking Open creates:

short-lived session
new tab URL
audit event
device-side stream grant

⸻

Minimal internal protocol

Cloud sends device a session grant:

{
  "type": "port_session_grant",
  "session_id": "pps_123",
  "service_id": "grafana",
  "target_host": "127.0.0.1",
  "target_port": 3000,
  "scheme": "http",
  "expires_at": 1783512000,
  "nonce": "abc",
  "signature": "cloud-signature"
}

Device responds:

{
  "type": "port_session_ready",
  "session_id": "pps_123",
  "device_id": "dev_123"
}

When browser connects:

cloud gateway receives HTTPS request
gateway validates session cookie/token
gateway opens stream to device:
  OPEN stream_id=abc target=grafana
device dials 127.0.0.1:3000
bytes flow both ways

⸻

Important production details

Timeouts

Use multiple timeouts:

session max lifetime: 10-60 min
idle timeout: 5-15 min
TCP connect timeout: 3-5 sec
request header timeout: 10 sec
stream idle timeout: configurable

Auditing

Record:

user
device
service
port
start time
end time
bytes in/out
HTTP method/path/status if HTTP-aware
source IP
session visibility

Do not necessarily record full response bodies unless customer explicitly enables it.

Rate limiting

Rate-limit by:

user
tenant
device
session
target service

Device-side enforcement

The device agent should reject any request where the cloud asks for a target not present in local policy.

This prevents a compromised cloud component or bug from turning into arbitrary LAN pivoting.

⸻

Path not to take

Avoid building it like this:

browser -> cloud -> arbitrary host/port on device LAN

That becomes dangerous quickly.

Avoid:

target_host = user input
target_port = user input

Prefer:

service_id = grafana

Then resolve service ID through policy.

⸻

Clean mental model

The product primitive should not be “forward port 3000.”

It should be:

Open a temporary authenticated browser session to a named device-local service.

So instead of exposing this UX:

Forward localhost:3000

Expose this UX:

Open Grafana
Open Device Dashboard
Open Camera Debug UI
Open Inference API Docs

Internally it still maps to a port, but your product and security model are service-oriented.

⸻

Bottom line

Yes, this exists as a known pattern. Your exact version would be closest to:

GitHub Codespaces port forwarding
+ Cloudflare Tunnel
+ your own device-agent connector
+ your own SSO/RBAC/audit/session system

Your proposed temporary subdomain per session is the right design. Use wildcard DNS/TLS, route by Host, create short-lived session records, proxy through an outbound device tunnel, and enforce a device-side service allowlist. This gives you the same convenience as VS Code/Codespaces-style port forwarding without giving up control of authentication, authorization, observability, or customer network exposure.

For temporary per-session subdomains like:

https://p-7xk92ma4.ports.example.com
https://p-a81bd92c.ports.example.com
https://p-anything.ports.example.com

you need a wildcard DNS record.

Recommended DNS setup

Assume your main domain is:

example.com

and you want all tunneled device ports under:

*.ports.example.com

Create this DNS record:

Type:  CNAME
Name:  *.ports
Value: your-cloud-gateway.example.com

Example:

*.ports.example.com  CNAME  port-gateway.example.com

Then point your gateway hostname to your load balancer/server:

port-gateway.example.com  A      203.0.113.10

or:

port-gateway.example.com  CNAME  your-lb.amazonaws.com

So the full chain becomes:

p-7xk92ma4.ports.example.com
        |
        v
*.ports.example.com
        |
        v
port-gateway.example.com
        |
        v
your cloud gateway / load balancer

⸻

Minimal setup

If your cloud gateway has a static public IP:

Type: A
Name: *.ports
Value: <your-gateway-public-ip>

Example:

*.ports.example.com  A  203.0.113.10

If you are behind AWS ALB, Cloudflare, Render, Fly.io, Railway, etc., use CNAME:

Type: CNAME
Name: *.ports
Value: your-load-balancer-hostname

Example:

*.ports.example.com  CNAME  abc123.elb.amazonaws.com

⸻

You also need wildcard TLS

DNS alone is not enough. HTTPS needs a certificate valid for:

*.ports.example.com

With Caddy, this can be simple:

*.ports.example.com {
    reverse_proxy localhost:9000
}

But wildcard certificates generally require DNS-01 ACME challenge, not normal HTTP challenge.

So with Caddy you usually configure your DNS provider plugin, for example Cloudflare:

{
    acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
}
*.ports.example.com {
    reverse_proxy localhost:9000
}

Your backend then reads the request host:

Host: p-7xk92ma4.ports.example.com

and maps it to a session:

p-7xk92ma4 -> session_id -> device_id -> target_port

⸻

Recommended production layout

Use a separate subdomain zone for tunnels:

app.example.com              main app
api.example.com              API
mqtt.example.com             MQTT
*.ports.example.com          temporary device web-port sessions

DNS records:

app.example.com              A/CNAME   main-app-lb
api.example.com              A/CNAME   api-lb
mqtt.example.com             A/CNAME   mqtt-lb
*.ports.example.com          CNAME     port-gateway-lb

Certificate coverage:

app.example.com
api.example.com
mqtt.example.com
*.ports.example.com

⸻

Best version for isolation

Even better, use a separate domain for tunnelled apps:

app.example.com
api.example.com
*.ports.example-ports.com

Why? Because proxied device-local web apps may be untrusted. Keeping them on a separate registrable domain helps isolate cookies and browser origins from your main app.

Example:

Type: CNAME
Name: *.ports
Domain: example-ports.com
Value: port-gateway.example.com

Result:

https://p-7xk92ma4.ports.example-ports.com

⸻

Final answer

For your model, use:

*.ports.yourdomain.com  CNAME  your-port-gateway-load-balancer

or, if directly pointing to an IP:

*.ports.yourdomain.com  A  your-gateway-public-ip

Then issue a wildcard TLS cert for:

*.ports.yourdomain.com

Your cloud gateway routes each request by the Host header and maps the random subdomain to the active tunnel session.

The log confirms the exact issue:

no solvers available for remaining challenges
configured=[tls-alpn-01 http-01]
offered=[dns-persist-01 dns-01]
remaining=[dns-persist-01 dns-01]

Meaning:

Caddy is trying to issue a wildcard cert for *.port.helix-kit.com.
Let's Encrypt only allows DNS-01 for wildcard certificates.
Your Caddy currently has only HTTP-01 and TLS-ALPN-01 enabled.
So wildcard TLS cannot be issued.

curl -k cannot bypass this because Caddy does not have a certificate to present during the TLS handshake.

⸻

Fix: use Caddy with Cloudflare DNS module

Your running Caddy does not have a DNS solver configured.

You need two things:

1. Caddy binary with the Cloudflare DNS module.
2. acme_dns cloudflare ... in the Caddyfile.

⸻

1. Build Caddy with Cloudflare plugin

Create Dockerfile:

FROM caddy:builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare
FROM caddy:latest
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

Build it:

docker build -t caddy-cloudflare .

Verify module exists:

docker run --rm caddy-cloudflare caddy list-modules | grep cloudflare

Expected:

dns.providers.cloudflare

⸻

2. Create Cloudflare API token

In Cloudflare, create an API token with:

Zone: Read
DNS: Edit

Scope it to:

helix-kit.com

Do not use your global API key if you can avoid it.

⸻

3. Update your Caddyfile

Use this:

{
    acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    # Optional while testing. Remove this when real cert works.
    # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}
helix-kit.com {
    root * /usr/share/caddy
    file_server
}
*.port.helix-kit.com {
    respond "Wildcard TLS works for {host}" 200
}

Important: once ready for a real browser-trusted cert, remove this if present:

acme_ca https://acme-staging-v02.api.letsencrypt.org/directory

Staging certs are not browser-trusted.

⸻

4. Recreate the container

docker rm -f caddy

Then run:

docker run -d \
  --name caddy \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  -e CLOUDFLARE_API_TOKEN="YOUR_TOKEN_HERE" \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" \
  -v "$PWD/site:/usr/share/caddy" \
  -v caddy_data:/data \
  -v caddy_config:/config \
  caddy-cloudflare

Watch logs:

docker logs -f caddy

You should now see Caddy solving DNS challenge instead of saying no solvers available.

⸻

5. Verify Caddy loaded the config

docker exec caddy caddy validate --config /etc/caddy/Caddyfile

Then:

docker exec caddy caddy list-modules | grep cloudflare

Expected:

dns.providers.cloudflare

⸻

6. Verify DNS challenge can work

Your DNS record should be:

*.port.helix-kit.com  A      15.207.108.147

or:

*.port.helix-kit.com  CNAME  helix-kit.com

For direct testing, keep it DNS only in Cloudflare.

Caddy will temporarily create TXT records like this during ACME validation:

_acme-challenge.port.helix-kit.com

That is why it needs DNS:Edit.

⸻

7. Test again

After Caddy obtains the cert:

curl -v https://xyz.port.helix-kit.com/

Expected:

HTTP/2 200
Wildcard TLS works for xyz.port.helix-kit.com

Check certificate:

openssl s_client \
  -connect xyz.port.helix-kit.com:443 \
  -servername xyz.port.helix-kit.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

To see SANs:

openssl s_client \
  -connect xyz.port.helix-kit.com:443 \
  -servername xyz.port.helix-kit.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text \
  | grep -A2 "Subject Alternative Name"

Expected SAN:

DNS:*.port.helix-kit.com

⸻

After test succeeds

Replace:

*.port.helix-kit.com {
    respond "Wildcard TLS works for {host}" 200
}

with:

*.port.helix-kit.com {
    reverse_proxy localhost:9000
}

Then your own backend on localhost:9000 can read:

Host: xyz.port.helix-kit.com

and map:

xyz -> session_id -> device_id -> target service/port

Your log is definitive: the only missing piece is the DNS-01 solver.