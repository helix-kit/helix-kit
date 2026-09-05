<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Experimental: multi-method SSH authentication (PAM + helix-authd)

The successor to [`../ldap-sssd`](../ldap-sssd), which proved **identity** — Helix
users in PostgreSQL resolving as Unix accounts. This lab proves **authentication**:
those users actually logging in over SSH, with every decision made by a Helix
daemon rather than by a password file.

```
ssh alice@device
      |
      v
    sshd  ->  PAM  ->  pam_helix.so
                            |
                   /run/helix/authd/auth.sock   (root-only)
                            |
                       helix-authd
                       /    |     \
                 online  offline  persistent
```

Identity still comes the same way it did before, and the two are kept strictly
apart: **LDAP/SSSD supplies identity through NSS and never authenticates anyone.**

## Status

**Phase 1 of [HELIX-217] is complete** — the PAM boundary, proven by `make test`
(38 checks). Authentication itself is still a stub: it selects a method and
returns a preconfigured verdict, so the socket, the PAM module, the sshd stack
and the resulting Unix identity could be proven on their own. The three real
methods land in later phases.

```
$ make test
38 passed, 0 failed
```

A login today looks like this:

```
$ docker compose exec ssh-client ssh alice@device
(alice@device) Helix device D123
Helix authentication method [online/offline/persistent]: online
Stub authenticator approved online for alice.
HELIX_AUTH_OK
user=alice
uid=200001
gid=200001
```

## Run it

```sh
make test        # build, boot, and run the whole matrix from a clean checkout
make up          # just start the stack
make ssh         # log in as alice, answering the method prompt
make shell       # a root shell on the device
make down        # stop and remove volumes
```

`make unit` runs the Go tests alone, against `linux/device/go`.

## Where the code lives

Deliberately split, because only half of this is an experiment:

| Path | What |
| --- | --- |
| `linux/device/go/internal/authproto` | The PAM↔authd wire protocol. |
| `linux/device/go/internal/authd` | The authentication engine: socket server, sessions, identity resolution. |
| `linux/device/go/cmd/helix-authd` | The daemon, a normal device-runtime app. |
| `experimental/ssh-auth/pam/` | `pam_helix.so`, the C conversation relay. |
| `experimental/ssh-auth/docker/` | The device and client images, sshd/PAM configuration. |
| `experimental/ssh-auth/scripts/` | The end-to-end harness. |

`helix-authd` is **not** lab code. It is a device-runtime app like `helix-shell`:
`servicemain.Run`, config from `/etc/helix`, and covered by `helix lint go`. Only
the PAM module, the container topology and the harness are experimental.

## The boundary that matters

`pam_helix.so` is loaded into sshd's address space, so it contains **no HTTP, no
cryptography, no policy, no database and no knowledge of the authentication
methods**. It opens a socket, relays what the daemon asks to display or prompt
for, sends back what the user typed, and translates one result into a PAM return
code. Every rule lives on the daemon side, which is what lets the three methods
be built without touching anything inside sshd.

There is no path through the module that grants authentication without an
explicit `approved` result. `make test` proves the failure paths: no daemon, no
socket, unknown Unix user, unknown method, a denied verdict, and neither password
nor public-key authentication able to succeed or bypass PAM.

## Three things this cost to get right

**Go's `os/user` cannot see LDAP users here.** The device runtime builds with
`CGO_ENABLED=0` so its binaries stay static and cross-compilable. Under that
build `os/user` reads `/etc/passwd` directly and **never consults NSS** — which
would make precisely the SSSD-provided users this daemon exists for invisible to
it. `helix-authd` resolves identity through `getent passwd`, the same NSS stack
sshd uses, so the two can never disagree about who a username is. There is a test
that fails if anyone changes it back.

**OpenSSH will not deliver an info-only PAM round.** A `display` with no prompt
makes sshd send an INFO_REQUEST with zero prompts; the client answers with zero
responses and the conversation stalls. `pam_helix.so` therefore buffers display
text and flushes it as a prefix to the next prompt, which is what PAM modules
conventionally do. The daemon still speaks in `display` and `prompt` events; only
the rendering changed.

**A stream socket coalesces frames.** The daemon writes `display` and `prompt`
back to back, and a single `read()` returns both. The first version of the reader
discarded everything after the first newline and deadlocked both ends. The
remainder now stays buffered — the ordinary buffered-line-reader discipline.

## Inspect it by hand

```sh
docker compose exec device getent passwd alice        # identity, via LDAP
docker compose exec device cat /etc/pam.d/sshd        # the whole auth policy
docker compose exec device /usr/sbin/sshd -T | sort   # effective sshd config
docker compose exec device tail -f /var/log/helix-authd.log
docker compose exec device ls -la /run/helix/authd/   # srw------- root root
```

Drive the daemon's verdict, and prove sshd fails closed without it:

```sh
docker compose exec device set-stub-decision deny
docker compose exec device stop-authd
```

The client image ships a PTY driver, because keyboard-interactive prompts are
read from a terminal and cannot be answered from a pipe:

```sh
docker compose exec ssh-client ssh-login alice@device \
  --answer 'method \[online/offline/persistent\]=online'
```

## Reconciliation with the source spec

[`SPEC.md`](./SPEC.md) is the brief this was built from, written by an author
unaware of the existing Helix components. Its security architecture is kept
essentially verbatim; the parts that reinvented things Helix already has were
reconciled first. The decisions, with reasons, are recorded on [HELIX-217]:

- Online authentication will use the **real Better Auth device-authorization
  flow**, not the spec's fake cloud — the plugin is already installed.
- Authorization (`device.login`, scopes, `policy_version`) is **mocked behind a
  provider interface**, because Helix genuinely has no user↔device authorization
  model yet and OpenFGA is not mature enough to wire in.
- `helix-authd` is a **real device-runtime app**, not a bespoke daemon.
- Device→cloud authentication uses the **real device access token**, not a
  "static development API key".
- `platform_user_uuid` becomes `platform_user_id` (**TEXT**): Helix's `user.id`
  is not a UUID.

## Known rough edges

- Home directories do not exist, so a session prints `Could not chdir to home
  directory`. The PAM session stack is deliberately `pam_permit` only; account
  and session policy are a later phase.
- Malformed-protocol and unsupported-version handling is covered by the Go unit
  tests rather than the container harness, because the device image has no
  scripting runtime able to speak a deliberately broken protocol at the socket.

[HELIX-217]: https://linear.app/helix-kit/issue/HELIX-217
