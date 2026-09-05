<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# HELIX-216 — Experimental Multi-Method SSH Authentication

## 1. Objective

Extend the existing experimental LDAP/SSSD implementation to prove Helix authentication end-to-end with three authentication modes:

```text id="iq37x8"
1. Online browser authentication
2. Offline one-time challenge/response
3. Persistent reusable credential
```

All three authentication methods must converge into the same local authenticated Helix session:

```text id="cik493"
AuthenticatedIdentity {
    platform_user_uuid
    username
    linux_uid
    device_id
    scopes
    policy_version
}
```

The experiment must prove:

```text id="ha3skm"
PostgreSQL
   |
helix-ldap
   |
SSSD / NSS
   |
sshd
   |
PAM
   |
pam_helix.so
   |
Unix socket
   |
helix-authd
   |
   +-- online
   +-- offline
   +-- persistent
```

The existing LDAP experiment remains responsible only for Unix identity.

Authentication remains entirely separate.

---

# 2. Existing Identity Path

Preserve the already-working path:

```text id="4zgh0e"
PostgreSQL
    |
helix-ldap
    |
SSSD
    |
NSS
    |
alice -> UID/GID 200001
```

Existing PostgreSQL user schema remains:

```sql id="u822os"
CREATE TABLE users (
    uuid UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    linux_uid BIGINT NOT NULL UNIQUE
);
```

Do not add passwords.

Do not use LDAP authentication.

Do not use `pam_sss` for authentication.

---

# 3. Authentication Modes

The user must be able to choose:

```text id="4mncqr"
Online Authentication
Offline Authentication
Persistent Credential
```

The choice is made during PAM authentication.

Conceptually:

```text id="vyj7c0"
ssh alice@device
       |
       v
   pam_helix
       |
       v
   helix-authd
       |
       v
Choose authentication method
       |
 +-----+---------+
 |     |         |
Online Offline Persistent
```

---

# 4. Important UI Architecture

Stock OpenSSH/PAM must remain supported.

However, stock PAM keyboard-interactive only provides string-oriented conversation prompts.

Therefore implement two client experiences.

## 4.1 Stock OpenSSH compatibility

This must work:

```bash id="4talpz"
ssh alice@device
```

The interaction may be textual:

```text id="2t0qxd"
Helix authentication method [online/offline/persistent]:
```

The user types:

```text id="q3sw7g"
online
```

This path exists for compatibility and debugging.

## 4.2 `helix-ssh` experimental client

Also implement:

```bash id="t5hxrg"
helix-ssh alice@device
```

This is a small Go SSH client built using:

```text id="qefzrh"
golang.org/x/crypto/ssh
golang.org/x/term
```

It must provide the intended product UX:

```text id="540lw2"
┌────────────────────────────────────────────┐
│          Helix Authentication              │
│                                            │
│  › Online authentication                   │
│    Offline authentication                  │
│    Persistent credential                   │
│                                            │
│  ↑/↓ select                  Enter choose  │
└────────────────────────────────────────────┘
```

Arrow keys move the selected item.

Enter chooses it.

The server/PAM still receives the canonical response:

```text id="cbr2jd"
online
offline
persistent
```

The custom client is UI only.

It must not perform authentication decisions itself.

---

# 5. Browser and Clipboard UX

When a method requires browser interaction, `helix-ssh` must display:

```text id="jo1ij5"
Open authentication page

https://...

Press Enter to open browser
```

When the user presses Enter:

```text id="vfggop"
helix-ssh
   |
   v
local OS browser opener
```

Use an injectable browser-opening abstraction.

Typical production implementations may use platform-specific mechanisms such as:

```text id="0tmq10"
Linux   -> xdg-open
macOS   -> open
Windows -> appropriate shell API
```

Tests must substitute a fake browser opener.

Do not put browser-launching logic inside `pam_helix.so`.

## Clipboard

For values already known by the client, automatically copy them when practical:

```text id="hsi6bf"
online user_code
offline challenge
persistent enrollment code
```

Use an injectable clipboard abstraction.

OSC 52 may be used as one implementation.

Tests must use a fake clipboard provider.

Always also display the value visibly as fallback.

---

# 6. Persistent Secret Clipboard Rule

The persistent credential itself is different.

The CLI must NOT receive the persistent credential from Cloud merely so it can copy it.

The persistent credential is revealed only through the authenticated browser.

The browser UI should provide one user action:

```text id="ojxzry"
[Reveal and Copy Credential]
```

That action must:

```text id="2yqu20"
1. atomically reveal the credential once;
2. attempt browser Clipboard API copy;
3. display it visibly if clipboard access fails;
4. permanently destroy the Cloud-side transient plaintext copy.
```

Reloading the page must not reveal the token again.

---

# 7. Component Topology

Extend the experiment to approximately:

```text id="d8ntuo"
+--------------------+
| PostgreSQL         |
| users              |
+---------+----------+
          |
          v
+--------------------+
| helix-ldap         |
+---------+----------+
          |
          v
+-------------------------------+
| Device container              |
|                               |
| SSSD / NSS                    |
| sshd                          |
| pam_helix.so                  |
| helix-authd                   |
| local state DB                |
+-------------+-----------------+
              |
              | HTTPS-like lab API
              v
+-------------------------------+
| helix-auth-backend            |
|                               |
| fake browser authentication   |
| fake AuthZ                    |
| online approval simulator     |
| offline response generator    |
| persistent enrollment relay   |
| scope API                     |
+-------------------------------+
```

`helix-auth-backend` represents Cloud.

It is NOT the final Helix backend implementation.

---

# 8. Fake Cloud Authentication

Do not integrate Better Auth yet.

For this experiment, implement a test-only browser identity mechanism.

The web UI should allow:

```text id="drzhj9"
Sign in as Alice
Sign in as Bob
```

This establishes an HttpOnly test session cookie.

All browser-side offline and persistent endpoints must require this session.

Do not accept:

```text id="baspmi"
username=alice
```

as authentication directly on sensitive endpoints.

The server must derive the user from the fake authenticated browser session.

This fake session layer is replaced with Better Auth later.

---

# 9. Fake AuthZ Model

Create a simple mutable authorization fixture.

Example:

```text id="4squwp"
Alice:

device D123:
    device.login
    app.foo.read
    app.foo.restart


Bob:

device D123:
    device.login
    app.bar.read
```

Represent scopes as canonical strings.

The backend must maintain:

```text id="shwhvn"
policy_version
```

Increment it whenever test AuthZ state changes.

Expose test-only endpoints allowing automated tests to:

```text id="ps8qnl"
change scopes
remove device.login
restore device.login
increment policy version
```

This replaces the real Helix AuthZ graph for the experiment.

---

# 10. Local Device State

`helix-authd` requires persistent local state.

Use SQLite.

Suggested database:

```text id="g1tx1x"
/var/lib/helix-authd/state.db
```

The device state must include at least:

```text id="7qc3db"
cached_users
persistent_credentials
device_state
```

---

# 11. Cached Users

Store:

```text id="k2x1qu"
CachedUser {
    platform_user_uuid
    username
    linux_uid

    scopes[]
    policy_version

    refreshed_at
    offline_valid_until
}
```

A user becomes cached only after a successful Cloud-connected authentication.

These count:

```text id="3nqyn2"
Method 1: Online
Method 3: Persistent
Method 3: Persistent enrollment
```

Method 2 does NOT create a previously unknown cached user.

---

# 12. Offline User Rule

Offline authentication is allowed only if:

```text id="vw6rbf"
SSSD already resolves the user
AND

helix-authd has CachedUser
AND

cached UUID/UID/username mapping is consistent
AND

cached scopes contain device.login
AND

scope cache is still valid for offline use
```

Therefore:

```text id="18foyh"
new platform user
+
device offline
=
OFFLINE LOGIN DENIED
```

This is intentional.

---

# 13. Scope Refresh

Whenever the device is online, scopes must be refreshed.

There are three refresh mechanisms.

## Successful Online Login

After Method 1 succeeds:

```text id="5dhcza"
Cloud returns:

platform UUID
username
linux UID
current scopes
policy version
```

Update `CachedUser` atomically.

## Successful Persistent Login

Method 3 must always call Cloud after local credential verification.

Cloud returns fresh:

```text id="fveoxx"
authorization result
scopes
policy version
```

Update the cache atomically.

## Background Refresh

`helix-authd` periodically refreshes all previously cached users while Cloud is reachable.

For the lab:

```text id="vqwcjn"
refresh interval = 5 seconds
```

Make it configurable.

Production cadence is deferred.

---

# 14. Offline Scope Lifetime

Add:

```text id="hpbltu"
OFFLINE_SCOPE_MAX_AGE
```

For automated tests use something short, for example:

```text id="7dpsrx"
60 seconds
```

The device computes:

```text id="e3cgqe"
offline_valid_until =
    successful_scope_refresh + OFFLINE_SCOPE_MAX_AGE
```

If expired:

```text id="rypv3q"
Offline authentication unavailable:
authorization cache is stale.
```

The product value will be decided later.

Trusted-time behavior is outside this experiment.

---

# 15. PAM Architecture

`pam_helix.so` must remain deliberately minimal.

It must NOT contain:

```text id="ozgel6"
HTTP
Better Auth logic
offline HMAC logic
persistent-token verification
SQLite logic
scope logic
browser logic
clipboard logic
AuthZ
```

Its job is:

```text id="9vvk1p"
PAM conversation
       ↕
pam_helix.so
       ↕
Unix socket
       ↕
helix-authd
```

---

# 16. PAM Unix Socket

Use:

```text id="j7fofk"
/run/helix-authd/auth.sock
```

with:

```text id="brgees"
AF_UNIX
SOCK_STREAM
```

Lab permissions:

```text id="q3w4so"
/run/helix-authd       root:root 0700
auth.sock              root:root 0600
```

Use newline-delimited JSON.

Maximum message size:

```text id="bxji3y"
16 KiB
```

Protocol:

```text id="8w8u4b"
version = 1
```

---

# 17. PAM/Authd Conversation Protocol

One socket connection represents one authentication attempt.

PAM begins:

```json id="erg2ry"
{
  "version": 1,
  "type": "start",
  "request_id": "uuid",
  "username": "alice",
  "pam_service": "sshd",
  "rhost": "192.0.2.1"
}
```

`helix-authd` resolves:

```text id="chkuju"
alice -> UID 200001
```

through the normal system identity path.

---

# 18. Authd Display Event

Server may send:

```json id="ct3xvo"
{
  "version": 1,
  "type": "display",
  "level": "info",
  "text": "..."
}
```

PAM maps:

```text id="9nw20g"
info  -> PAM_TEXT_INFO
error -> PAM_ERROR_MSG
```

---

# 19. Authd Prompt Event

Server sends:

```json id="2m3apv"
{
  "version": 1,
  "type": "prompt",
  "prompt_id": "auth_method",
  "text": "Helix authentication method [online/offline/persistent]:",
  "secret": false
}
```

PAM maps:

```text id="kvvzhd"
secret=false -> PAM_PROMPT_ECHO_ON
secret=true  -> PAM_PROMPT_ECHO_OFF
```

PAM replies:

```json id="7unsl5"
{
  "version": 1,
  "type": "prompt_response",
  "prompt_id": "auth_method",
  "value": "online"
}
```

Never log `value` when:

```text id="apxx6o"
secret=true
```

---

# 20. Final PAM Result

Success:

```json id="0ks2ns"
{
  "version": 1,
  "type": "result",
  "status": "approved"
}
```

Failure examples:

```json id="xf9kxq"
{
  "version": 1,
  "type": "result",
  "status": "denied",
  "reason": "authorization_denied"
}
```

or:

```json id="1q37hn"
{
  "version": 1,
  "type": "result",
  "status": "unavailable",
  "reason": "cloud_unavailable"
}
```

Map:

```text id="17hv18"
approved
    -> PAM_SUCCESS

denied
    -> PAM_AUTH_ERR

expired
    -> PAM_AUTH_ERR

invalid_credential
    -> PAM_AUTH_ERR

unavailable
    -> PAM_AUTHINFO_UNAVAIL

protocol_error
    -> PAM_AUTHINFO_UNAVAIL
```

Fail closed.

---

# 21. Method 1 — Online Authentication

This phase implements the server/PAM/client state machine, but NOT real Better Auth.

Define an internal Go interface such as:

```go id="iss0pc"
type OnlineAuthenticator interface {
    Start(ctx context.Context, login LoginRequest) (*OnlineChallenge, error)
    Wait(ctx context.Context, challengeID string) (*CloudIdentity, error)
}
```

Use a fake Cloud implementation.

The future Better Auth implementation must replace this provider without modifying:

```text id="881lut"
sshd
PAM
pam_helix.so
Unix socket protocol
method-selection UX
local session model
```

---

# 22. Method 1 User Flow

User chooses:

```text id="2rkcio"
Online Authentication
```

Authd starts fake online authorization.

Return something equivalent to:

```text id="cp6zpr"
verification_uri
verification_uri_complete
user_code
transaction ID
```

PAM displays a browser prompt.

Stock SSH:

```text id="s63zz0"
Open:

https://...

Code:
ABCD-EFGH

Press Enter after opening the browser:
```

`helix-ssh` instead renders a panel and:

```text id="sp99xd"
copies ABCD-EFGH
waits for Enter
opens browser
responds to PAM
```

Then `helix-authd` polls.

Statuses:

```text id="6d5hkm"
pending
approved
denied
expired
```

---

# 23. Future Better Auth Adapter

Later, replace the fake provider with the current Better Auth Device Authorization flow.

Expected semantics:

```text id="ez8wr1"
request device/user code
display verification URI
poll device token endpoint
receive Better Auth session token
resolve authenticated platform user
request current Helix device AuthZ/scopes
```

Do not persist the Better Auth session token on the appliance beyond what is required to resolve the login.

---

# 24. Method 1 Identity Validation

After online authentication Cloud must return:

```text id="w6m6kr"
platform_user_uuid
username
linux_uid
scopes
policy_version
```

The device must verify:

```text id="u4a4u3"
PAM requested username == Cloud username

resolved NSS UID == Cloud linux_uid
```

Mismatch:

```text id="roua2c"
DENY
```

Then verify:

```text id="nrtdao"
device.login ∈ scopes
```

Only then update cached scopes and return PAM success.

---

# 25. Method 2 — Offline One-Time Authentication

This mode exists for:

```text id="i7q3si"
device cannot reach Cloud
```

while:

```text id="yrvisg"
user has another Internet-connected device
```

It is NOT intended for a situation where both the appliance and the user's phone lack Cloud access.

---

# 26. Offline Prerequisites

Before offering a usable challenge, verify:

```text id="u917hb"
CachedUser exists
offline scope cache valid
device.login cached
UID/username mapping valid
```

If not:

```text id="e0oy4g"
Offline authentication unavailable.
```

No new user may bootstrap offline access.

---

# 27. Offline Device Secret

For the experiment provision one random:

```text id="sh23uf"
K_device = 256-bit secret
```

to:

```text id="6owcsu"
helix-authd
helix-auth-backend
```

using separate lab configuration.

Never use one global fleet secret in product architecture.

Production key provisioning/TPM protection is deferred.

---

# 28. Offline Challenge

Device generates:

```text id="upsr64"
5 random bytes
```

and encodes them as exactly 8 characters using:

```text id="24eaew"
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Display formatted:

```text id="br9mwv"
K7MP-Q29X
```

Canonical representation excludes the hyphen:

```text id="95nh1d"
K7MPQ29X
```

Challenge lifetime:

```text id="g4rhfl"
5 minutes
```

Use a monotonic deadline while the PAM transaction is alive.

---

# 29. Offline User Experience

Stock SSH:

```text id="65zp2y"
Offline Helix Authentication

Device:
D123

Open:
https://...

Challenge:
K7MP-Q29X

Response:
```

`helix-ssh`:

```text id="al2cxf"
copies K7MP-Q29X
offers "Press Enter to open browser"
opens the static Offline Authentication page
```

User logs into Cloud using fake browser authentication.

The browser page requests:

```text id="vobiyh"
Device ID
Challenge
```

It does NOT ask who the user is.

The backend derives identity from the authenticated browser session.

---

# 30. Offline Cloud Authorization

When authenticated Alice submits:

```text id="1m2row"
device = D123
challenge = K7MPQ29X
```

Cloud:

```text id="y4g0jf"
1. resolves authenticated Alice UUID;
2. obtains Alice linux_uid;
3. verifies Alice currently has device.login on D123;
4. loads K_device;
5. computes the response.
```

If Alice no longer has access:

```text id="thnkvb"
DENY
```

No response code is generated.

---

# 31. Offline Response Construction

Use HMAC-SHA256.

Construct the HMAC message canonically.

For example:

```text id="sqlzsx"
"HXOFF1"
||
uint16_be(len(device_id))
||
device_id bytes
||
user_uuid as 16 bytes
||
uint64_be(linux_uid)
||
challenge raw 5 bytes
```

Then:

```text id="hs1vld"
digest =
HMAC-SHA256(K_device, message)
```

Take:

```text id="a7on5x"
first 5 bytes
```

and encode using the same 32-character alphabet.

Result:

```text id="8dx5nw"
M7QP-2KWX
```

This gives a 40-bit short response.

---

# 32. Offline Verification

Device already knows:

```text id="850pgx"
device ID
cached Alice UUID
Alice linux_uid
current challenge
K_device
```

It independently computes the expected response.

Compare in constant time.

Allow:

```text id="kuhvgs"
maximum 3 response attempts
```

After 3 failures:

```text id="meao0s"
destroy challenge
authentication fails
```

On success:

```text id="xp8e36"
destroy challenge immediately
```

A used challenge can never be reused in the same transaction.

Every new SSH attempt generates a new challenge.

---

# 33. Bob-vs-Alice Offline Test

Required security test:

```text id="qlvfwh"
ssh alice@device
```

Device expects response derived from:

```text id="cf80em"
Alice UUID
Alice UID
```

Bob authenticates to Cloud and enters Alice's displayed challenge.

Cloud correctly generates:

```text id="et9x1u"
HMAC(... Bob UUID, Bob UID ...)
```

Bob enters that response.

Device computes:

```text id="dhzb8q"
HMAC(... Alice UUID, Alice UID ...)
```

They differ.

Login must fail.

---

# 34. Offline Scope Semantics

The 8-character response proves:

```text id="j1vos6"
Cloud currently authorized this user
for this device/login challenge.
```

It does NOT contain:

```text id="ciqel5"
scopes
roles
groups
policy version
app authorization
```

After successful offline authentication, the device uses the already-cached scope snapshot.

Therefore:

```text id="hbo6lr"
fresh Cloud login authorization
+
recent cached local scopes
=
offline session
```

---

# 35. Method 3 — Persistent Credential

Persistent authentication is reusable and Cloud-connected.

It is intended for:

```text id="y6e3k2"
repeated debugging
long work sessions
automation
AI agents
scripts
```

The credential is NOT an offline credential.

If Cloud cannot be reached:

```text id="5tn440"
Persistent authentication unavailable.

Use Offline Authentication instead.
```

---

# 36. Persistent Credential Storage Rule

The credential secret must never be durably stored in Cloud.

The durable states are:

```text id="n8wlzq"
User:
    plaintext credential

Device:
    credential verifier + metadata

Cloud:
    no persistent credential record
```

Cloud may transiently hold the plaintext only while relaying a pending enrollment credential to the authenticated browser for one-time display.

It must never enter:

```text id="aqe91n"
PostgreSQL
logs
traces
analytics
event payloads
metrics labels
crash reports
```

---

# 37. Persistent Credential Format

Use:

```text id="1xfiwq"
hlx1_<credential_id>_<secret>
```

Example:

```text id="bt2xvp"
hlx1_D7K4P9QX_1tBc9hWz0jlyHNhQd6X9B3h7IyMdxk9BqCEgTlePgeQ
```

`hlx1`:

```text id="ybuogs"
format/version prefix
```

`credential_id`:

```text id="aa2e65"
8-character Base32 identifier
```

It is NOT secret.

`secret`:

```text id="s6vhs4"
32 random bytes
Base64URL
no padding
~43 characters
256 bits entropy
```

Input parsing must be strict.

---

# 38. Device Credential Verifier

Generate a device-local:

```text id="6pr0nh"
K_credential
```

for the experiment.

Protect lab file:

```text id="xkm87f"
root:root
0600
```

When generating credential:

```text id="ktsktf"
verifier =
HMAC-SHA256(K_credential, secret)
```

Store only:

```text id="d5i5nq"
credential_id
verifier
user UUID
linux UID
username
state
timestamps
```

Discard plaintext secret from device memory after sending it into the one-time Cloud enrollment relay.

Use constant-time verifier comparison.

---

# 39. Persistent Credential States

Exactly:

```text id="ugzkwa"
PENDING
ACTIVE
EXPIRED
REVOKED
```

Allowed transitions:

```text id="dcd507"
PENDING -> ACTIVE
PENDING -> EXPIRED

ACTIVE -> EXPIRED
ACTIVE -> REVOKED
```

`EXPIRED` and `REVOKED` are terminal.

There may be at most one:

```text id="sufj5p"
ACTIVE
```

credential per:

```text id="8cf5vw"
(user, device)
```

and at most one enrollment being created for that user/device.

---

# 40. Persistent Enrollment UX

User chooses:

```text id="3ni6k5"
Persistent Credential
```

If no active credential exists, ask:

```text id="jwmktf"
Credential duration in hours:
```

`helix-ssh` should render this as a clean numeric input view.

For experiment:

```text id="zq71zz"
minimum = 1 hour
maximum = 168 hours
```

Make configurable.

Cloud must be allowed to reject an excessive requested duration.

---

# 41. Persistent Enrollment Creation

Device generates:

```text id="cs4pjb"
credential_id
secret
verifier
```

Creates local:

```text id="nflxnu"
state=PENDING
```

Pending enrollment lifetime:

```text id="f0dwnh"
5 minutes
```

Do NOT start the requested credential lifetime yet.

Device creates a Cloud enrollment containing:

```text id="auzuor"
device_id
requested username
requested linux UID
requested duration
credential ID
plaintext credential
```

The credential exists in Cloud memory only as transient pending enrollment data.

Cloud returns:

```text id="4go8hi"
enrollment_id
user_code
verification_uri
```

---

# 42. Persistent Browser Enrollment

The browser user:

```text id="fdtl7p"
1. authenticates;
2. enters/opens enrollment code;
3. sees device + requested duration;
4. explicitly approves;
5. requests one-time credential reveal.
```

Cloud verifies:

```text id="9lft5m"
browser user maps to requested Linux user
device.login currently allowed
requested duration allowed
```

Cloud also returns current:

```text id="dnri3s"
scopes
policy version
```

---

# 43. One-Time Reveal

Browser UI provides:

```text id="oejuw7"
Reveal and Copy Credential
```

The server must atomically:

```text id="gay7lt"
retrieve plaintext
mark revealed
remove plaintext from enrollment state
return plaintext once
```

Second attempt:

```text id="nt228a"
410 Gone / already revealed
```

Browser shows:

```text id="itoc78"
hlx1_...
```

and attempts clipboard copy.

Warn:

```text id="1gs3yb"
This credential will not be shown again.

Return to your terminal and paste it to activate it.
```

---

# 44. Activation Proof

Cloud approval alone does NOT activate the persistent credential.

After approval/reveal, the originating SSH session prompts:

```text id="4b9pj4"
Paste persistent credential to activate:
```

This uses:

```text id="ij14pi"
PAM_PROMPT_ECHO_OFF
```

User pastes the credential.

Device verifies:

```text id="ixw3xh"
prefix
credential ID
secret verifier
pending enrollment identity
Cloud approval identity
```

All must match.

Then:

```text id="vagxfu"
PENDING -> ACTIVE
```

Set:

```text id="p4ql84"
activated_at = now
expires_at = activated_at + approved duration
```

The current SSH login succeeds.

---

# 45. Abandoned Enrollment

If user closes browser or loses the credential before pasting:

```text id="2f7d8i"
PENDING
```

expires after:

```text id="ch3y5r"
5 minutes
```

Delete the pending verifier and metadata.

There is no active credential to revoke.

User can restart enrollment.

---

# 46. Existing Active Credential UX

If user selects Persistent and a credential exists:

```text id="ixqmfv"
Persistent credential active

Expires in:
17h 42m

› Use existing credential
  Revoke and create new
  Back
```

`helix-ssh` uses arrow keys.

Stock SSH prompt:

```text id="br1n39"
Persistent credential action [use/rotate/back]:
```

---

# 47. Persistent Rotation

If user selects:

```text id="xhe0yy"
Revoke and create new
```

then immediately:

```text id="u28y5c"
ACTIVE -> REVOKED
```

The old credential must fail from that moment onward.

Start a new enrollment.

If new enrollment is abandoned:

```text id="l1a7fd"
no active credential remains
```

This is intentional.

---

# 48. Subsequent Persistent Login

User chooses:

```text id="hr7wgb"
Persistent Credential
```

and:

```text id="ifscv2"
Use existing credential
```

Prompt secretly:

```text id="rdip77"
Persistent credential:
```

Device:

```text id="w66e6m"
1. parses token;
2. locates credential ID;
3. verifies ACTIVE state;
4. verifies not expired;
5. compares verifier;
6. verifies token belongs to requested UID/user;
```

Only after local verification succeeds does it contact Cloud.

---

# 49. Cloud Reauthorization on Every Persistent Login

Persistent credential possession is authentication.

It is NOT permanent authorization.

Device sends a device-authenticated request:

```text id="mw6w4o"
device = D123
user UUID = U123
requested action = device.login
```

Cloud checks current AuthZ.

If denied:

```text id="0ai394"
LOGIN DENIED
```

even if credential has not expired.

If allowed, Cloud returns:

```text id="p10hlg"
current scopes
policy version
username
linux UID
```

Device verifies identity mapping and updates `CachedUser`.

Then PAM succeeds.

---

# 50. Cloud Does Not Verify the Bearer Secret

The bearer credential is verified locally by the device.

Cloud verifies:

```text id="0c3tk6"
authenticated device
+
asserted authenticated user identity
+
current authorization
```

The persistent secret itself is not sent to or stored by Cloud during normal login.

For the lab, authenticate the device to Cloud using a static development device API key.

Production mTLS/device certificates are deferred.

---

# 51. Persistent Credential Cloud Failure

If local credential is correct but Cloud cannot be reached:

```text id="kf8e2u"
Persistent authentication unavailable.
```

Do NOT silently fall back to cached authorization.

Do NOT automatically switch to offline authentication.

Return to method selection so the user may explicitly select:

```text id="o9g88c"
Offline Authentication
```

---

# 52. Automation Support

Persistent credentials are specifically intended to support automation.

Add to `helix-ssh`:

```text id="kpduq2"
--auth persistent
--credential-file /path/to/credential
```

Credential file must be read locally.

Recommend/require:

```text id="nryq6u"
0600
```

Do NOT support secrets through:

```text id="h4k4c5"
command-line token arguments
shell history
process-list-visible arguments
```

Do not require an environment variable containing the credential.

For automated tests, allow secure stdin/file-fixture injection.

Later integration with OS credential stores is deferred.

---

# 53. sshd Configuration

Use a dedicated experimental sshd configuration.

Required semantics:

```text id="lefe0w"
UsePAM yes

KbdInteractiveAuthentication yes

PasswordAuthentication no
PubkeyAuthentication no
GSSAPIAuthentication no
HostbasedAuthentication no

AuthenticationMethods keyboard-interactive:pam

PermitRootLogin no
PermitEmptyPasswords no

DisableForwarding yes
X11Forwarding no
PermitTunnel no

UseDNS no
```

Use a reasonable authentication grace time for browser interaction.

Lab recommendation:

```text id="yuqabp"
LoginGraceTime 5m
```

Validate before startup:

```bash id="upb7pj"
sshd -t
sshd -T
```

---

# 54. PAM Stack

Use a minimal experimental `/etc/pam.d/sshd`:

```text id="huphnu"
#%PAM-1.0

auth    requisite    pam_helix.so socket=/run/helix-authd/auth.sock

account required     pam_permit.so
session required     pam_permit.so
```

No:

```text id="tkabvy"
pam_unix authentication
pam_sss authentication
password fallback
```

Account/session policy is deferred.

---

# 55. Post-Authentication Command

Do not build the restricted BusyBox shell yet.

Force a test command:

```text id="hy0b5z"
/usr/local/bin/helix-auth-success
```

Output:

```text id="2de80n"
HELIX_AUTH_OK
user=alice
uid=200001
gid=200001
```

This proves:

```text id="n9vz5w"
LDAP/SSSD identity
+
PAM authentication
+
correct Unix process identity
```

end-to-end.

---

# 56. Authentication Timeouts

Suggested lab values:

```text id="r6dgsx"
Online browser transaction:
2 minutes

Offline challenge:
5 minutes

Persistent enrollment:
5 minutes

Persistent Cloud reauthorization:
10 seconds

Local Unix socket request:
bounded by active auth transaction

sshd LoginGraceTime:
5 minutes
```

Make test timeouts configurable so CI can use shorter values.

---

# 57. Cancellation

If the SSH client disconnects:

```text id="17r2wr"
PAM connection closes
    |
helix-authd cancels context
    |
network polling stops
```

Pending online/persistent Cloud transactions may expire naturally.

Do not leave abandoned goroutines running indefinitely.

---

# 58. Fail-Closed Requirements

All of these must deny authentication:

```text id="v3g4pe"
helix-authd unavailable
socket unavailable
malformed socket protocol
unknown protocol version
identity mismatch
UID mismatch
Cloud AuthZ denial
online approval denial
online timeout
offline stale cache
offline unknown user
offline invalid response
offline challenge exhausted
persistent malformed token
persistent verifier mismatch
persistent expired token
persistent revoked token
persistent Cloud unavailable
persistent current AuthZ denial
PAM conversation failure
```

No password fallback.

---

# 59. Backend APIs

Implement a small lab backend.

Exact routing may vary, but functionality must exist.

## Online simulator

Provide:

```text id="qgmnsv"
start transaction
get transaction status
approve
deny
```

The API should model Better Auth-style polling semantics closely enough that replacing the adapter later is straightforward.

## Offline

Provide browser-authenticated:

```text id="ivj2nd"
POST /v1/offline/response
```

Input:

```json id="1tt24d"
{
  "device_id": "D123",
  "challenge": "K7MPQ29X"
}
```

Identity comes from browser session.

Return:

```json id="zljdhe"
{
  "response": "M7QP2KWX"
}
```

only if current AuthZ allows `device.login`.

## Persistent enrollment

Provide:

```text id="yrq427"
create enrollment
browser claim/view
approve
one-time reveal
poll enrollment status
```

Plaintext secret exists only transiently until reveal.

## Scope APIs

Provide device-authenticated:

```text id="wjuwns"
authorize user for login
fetch current user scopes
refresh cached users
```

---

# 60. Background Scope Refresh

The device must periodically call Cloud for each cached user.

Successful result:

```text id="btt9f5"
update scopes
update policy_version
update refreshed_at
update offline_valid_until
```

If Cloud says user no longer has `device.login`:

```text id="wskrqo"
cache latest scopes/denial state
```

Do not necessarily delete a persistent authentication credential.

The credential may remain cryptographically valid while Cloud authorization denies access.

---

# 61. Docker Topology

Extend Compose approximately:

```text id="tso0kk"
postgres
helix-ldap
device
helix-auth-backend
ssh-client
```

`device` contains:

```text id="d1k50p"
SSSD
sshd
pam_helix.so
helix-authd
SQLite local state
```

`ssh-client` contains:

```text id="gns339"
OpenSSH client
helix-ssh
test browser opener
test clipboard provider
PTY test tooling
```

---

# 62. Suggested Repository Layout

Approximately:

```text id="bme7lo"
experimental/ldap-sssd/
├── cmd/
│   ├── helix-ldap/
│   ├── helix-authd/
│   ├── helix-auth-backend/
│   └── helix-ssh/
│
├── internal/
│   ├── authproto/
│   ├── authd/
│   │   ├── online/
│   │   ├── offline/
│   │   ├── persistent/
│   │   ├── scopes/
│   │   └── state/
│   │
│   ├── authbackend/
│   └── sshclient/
│
├── pam/
│   └── pam_helix.c
│
├── docker/
│   ├── device/
│   └── ssh-client/
│
├── scripts/
│   ├── auth-e2e.sh
│   └── tui-e2e.sh
│
└── docs/
    └── authentication-experiment.md
```

Keep modules small.

---

# 63. Required Automated Tests — Identity

Existing HELIX-216 checks must continue passing:

```text id="658s76"
getent passwd alice
getent passwd 200001
id alice
getent group alice
```

Do not regress LDAP/SSSD behavior.

---

# 64. Required Automated Tests — PAM

Verify:

```text id="gz5kff"
PAM-only keyboard-interactive authentication works
password authentication cannot succeed
public-key authentication cannot bypass PAM
missing helix-authd fails closed
malformed authd protocol fails closed
unknown Unix user cannot authenticate
```

---

# 65. Required Automated Tests — Online

Test:

```text id="q2jdit"
pending login remains blocked
approval succeeds
denial fails
expiration fails
Alice approval for alice succeeds
Bob approval for alice fails
successful login refreshes scope cache
policy_version is updated
```

---

# 66. Required Automated Tests — Offline

First cache Alice using an online authentication.

Then simulate device Cloud connectivity loss.

Test:

```text id="zrbx3v"
cached Alice receives offline challenge
challenge is 8 Base32 characters
correct Alice response succeeds
Bob-generated response for Alice fails
incorrect response fails
3 incorrect responses destroy challenge
used response cannot authenticate a new challenge
unknown/uncached user cannot authenticate offline
stale scope cache prevents offline authentication
Cloud AuthZ denial prevents backend issuing response
offline device itself performs no Cloud API request
```

Also verify the login uses cached scopes.

---

# 67. Required Automated Tests — Scope Cache

Test:

```text id="i2avlo"
online login caches scopes
persistent login refreshes scopes
background job refreshes scopes
policy change propagates while online
offline mode retains last valid cached scopes
offline cache expires at configured maximum age
```

---

# 68. Required Automated Tests — Persistent Enrollment

Test:

```text id="jhwi4a"
duration requested in terminal
Cloud approval required
token is 256-bit random secret
token has hlx1 format
Cloud reveal works exactly once
second reveal fails
token is not stored in PostgreSQL
token does not remain in backend state after reveal
device state stores verifier, not plaintext token
credential remains PENDING before terminal proof
pasting correct token activates it
wrong token does not activate it
abandoned PENDING enrollment expires
credential lifetime begins at activation
current enrollment login succeeds after activation
```

---

# 69. Required Automated Tests — Persistent Login

Test:

```text id="182176"
active token authenticates locally
Cloud is contacted after local verification
Cloud current device.login permission is required
fresh scopes are returned and cached
wrong token fails
expired token fails
revoked token fails
Cloud unavailable fails
Cloud denial fails despite locally valid token
token cannot authenticate a different Unix user
token cannot authenticate another device
```

---

# 70. Required Automated Tests — Rotation

Test:

```text id="g5k5kw"
only one active token exists
rotation revokes old token immediately
old token fails after rotation starts
new credential is PENDING
new token activates only after paste-back proof
abandoned replacement leaves old token revoked
```

---

# 71. Required Automated Tests — Automation

Use:

```text id="gj4cb9"
helix-ssh --auth persistent --credential-file ...
```

Verify:

```text id="3fgujr"
no interactive browser required
no token appears in process arguments
authentication succeeds
Cloud authorization still occurs
scopes refresh
```

---

# 72. Required Automated Tests — TUI

Run `helix-ssh` under a PTY.

Test actual key sequences:

```text id="i2qjbj"
Down
Down
Up
Enter
```

Verify highlighted selection moves correctly.

Verify:

```text id="jvqmcb"
Enter invokes configured browser opener
online code is copied through clipboard abstraction
offline challenge is copied
persistent enrollment code is copied
secret prompts do not echo
```

Do not fake the selection logic by directly calling internal functions only.

At least one PTY integration test must exercise it.

---

# 73. Security Logging

Log:

```text id="7j8z8n"
request ID
authentication method
platform UUID after known
username
Linux UID
device ID
transaction ID
result
policy version
duration
latency
```

Never log:

```text id="hvv5i4"
persistent plaintext credential
offline device secret
K_credential
Better Auth session token
secret PAM response
```

Offline 8-character challenge/response logging should also be avoided by default.

---

# 74. Security Invariants

The experiment must preserve all of these:

```text id="1kbx1b"
Identity != authentication.

Authentication != authorization.

LDAP never authenticates human users.

PAM contains no Cloud protocol logic.

No new user can authenticate offline.

Offline response is bound to:
device + platform user + Linux UID + challenge.

Offline response does not carry scopes.

Persistent credential secret is never durably stored in Cloud.

Persistent credential plaintext is never durably stored on device.

Persistent credential requires Cloud authorization on every use.

Persistent credential is useless for another user/device.

Only one persistent credential is active per user/device.

Persistent enrollment requires proof of possession before activation.

Cloud remains canonical for current authorization/scopes.

Device can enforce cached authorization while offline only within a bounded cache lifetime.
```

---

# 75. Explicit Non-Goals

Do not implement yet:

```text id="0to4jr"
real Better Auth integration
production Helix AuthZ integration
production device certificates
TPM key protection
fully offline phone + device authentication
root/helix elevation
restricted BusyBox shell
app authorization gateway
production audit synchronization
SELinux/AppArmor policy
production trusted-time solution
production credential store integration
production multi-device synchronization
```

---

# 76. Definition of Done

`make test` from a clean checkout must prove:

```text id="kgxteo"
[PASS] Existing PostgreSQL -> LDAP -> SSSD -> NSS experiment still works.

[PASS] sshd uses PAM-backed keyboard-interactive authentication.

[PASS] Three authentication methods are selectable.

[PASS] Stock OpenSSH has a functional textual fallback.

[PASS] helix-ssh provides arrow-key method selection.

[PASS] helix-ssh can open the browser on Enter.

[PASS] helix-ssh automatically copies short codes/challenges.

[PASS] Online approval simulator supports approve/deny/timeout.

[PASS] Online success returns identity and refreshes scopes.

[PASS] Offline login works with an Internet-disconnected appliance.

[PASS] Offline login is impossible for never-cached users.

[PASS] Offline Alice/Bob identity substitution fails.

[PASS] Offline response is exactly 8 Base32 characters.

[PASS] Offline response replay fails.

[PASS] Stale cached scopes disable offline login.

[PASS] Persistent enrollment requests duration from the terminal.

[PASS] Persistent credential is shown by Cloud exactly once.

[PASS] Persistent credential is not durably stored by Cloud.

[PASS] Device stores only a verifier.

[PASS] Credential stays PENDING until pasted into originating SSH flow.

[PASS] Correct paste activates credential.

[PASS] Abandoned pending enrollment expires.

[PASS] Subsequent persistent login needs no browser.

[PASS] Persistent login always requires Cloud reauthorization.

[PASS] Persistent login refreshes scopes.

[PASS] Persistent login fails when Cloud is unavailable.

[PASS] Persistent login fails after current device access is revoked.

[PASS] Persistent rotation invalidates the previous credential.

[PASS] Only one persistent credential is active per user/device.

[PASS] Persistent credential can be supplied safely from a credential file for automation.

[PASS] All secret-bearing PAM prompts are non-echoing.

[PASS] No authentication method can fall back to a local password.
```

---

# 77. Architectural Result

Successful completion should prove this final experimental architecture:

```text id="qzy8px"
                       HELIX CLOUD
                    canonical AuthZ
                         scopes
                           |
          +----------------+----------------+
          |                |                |
      online auth     offline response   persistent
       simulator          service        reauthorize
          |                |                |
          +----------------+----------------+
                           |
                           |
                       DEVICE
                           |
                      helix-authd
                           |
             +-------------+-------------+
             |             |             |
          online         offline      persistent
             |             |             |
             +-------------+-------------+
                           |
                     CachedUser state
                           |
                      PAM result
                           |
                     pam_helix.so
                           |
                         sshd
                           |
                          UID
```

The important long-term boundary is:

```text id="jio5hu"
pam_helix.so
    =
generic PAM conversation relay

helix-authd
    =
device authentication/session engine

Cloud
    =
canonical current authorization authority
```

Real Better Auth must later plug into Method 1 without redesigning the other two methods or the PAM boundary.