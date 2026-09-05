<!--
SPDX-FileCopyrightText: 2026 Hardik Jain
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# PostgreSQL-Backed LDAP Identity for Linux (Experiment)

Date: 2026-09-05

Can a Linux box treat Helix users as real Unix accounts when their canonical
records exist only as rows in PostgreSQL — no directory server, no user
provisioning, no `/etc/passwd` entries pushed to devices?

**Yes.** The experiment lives in [`experimental/ldap-sssd/`](../experimental/ldap-sssd/)
and proves the whole path automatically in one command (`make test`, 44 checks).
This document records what was established and what it costs; the lab's
[README](../experimental/ldap-sssd/README.md) is the operating manual and
[SPEC.md](../experimental/ldap-sssd/SPEC.md) the original brief.

## The result

```
getent passwd alice -> glibc NSS -> libnss_sss -> SSSD -> LDAP -> helix-ldap -> PostgreSQL
```

```
alice:*:200001:200001:alice:/home/alice:/usr/libexec/helix/session-launcher
uid=200001(alice) gid=200001(alice) groups=200001(alice)
```

Nothing about `alice` is stored twice. PostgreSQL holds four columns —
`uuid, email, username, linux_uid` — and a small Go service projects them into
LDAP on demand. Add a row and the next `getent` sees it; delete it and, once the
SSSD cache is invalidated, it is gone. There is no synchronization job, no
replica directory and no restart in that loop, which is the property the whole
design rests on.

## Why this shape

The alternative to a façade is running an actual directory (OpenLDAP, 389-ds)
and syncing users into it. That makes the directory a second source of truth and
buys a permanent reconciliation problem. Projecting instead keeps one canonical
store:

```
PostgreSQL = canonical data
LDAP       = protocol projection
SSSD       = Linux-side identity broker and cache
NSS        = Linux lookup interface
```

**Everything Unix-specific is synthesized, not stored.** `gidNumber` = `uidNumber`
(a private primary group per user, so no group table is needed at all),
`homeDirectory` = `/home/<username>`, `loginShell`, the DNs, the objectClasses
and the `posixGroup` entry are all computed per request. That keeps the schema
free of Unix concerns Helix does not otherwise care about, and it means changing
the login shell for every user is a config change, not a migration.

**LDAP is read-only and identity-only.** Every write operation is refused with
`unwillingToPerform`. No password is stored, projected or accepted for a user —
`shadow` deliberately does not route through SSSD in `/etc/nsswitch.conf`.
Authentication was excluded on purpose so this layer could be proven on its own.

## What the experiment establishes

- **SSSD is satisfied by a synthesized directory.** It needs no schema tricks:
  `ldap_schema = rfc2307` with `posixAccount`/`posixGroup` and the standard
  attribute names is enough. It issues compound filters
  (`(&(objectClass=posixAccount)(uid=alice))`), which the façade must handle.
- **Selective predicates can be pushed into SQL safely.** `uid=X` becomes
  `WHERE username = $1`, `uidNumber=N` becomes `WHERE linux_uid = $1`. Only
  predicates the filter *requires* (the filter itself, or a child of a top-level
  AND) may be pushed down — under an OR or a NOT they are optional, and pushing
  them would drop matching rows. Everything else enumerates under a hard
  `LIMIT`, so no LDAP query can trigger an unbounded scan.
- **SSSD's cache gives free offline identity resolution.** With the façade
  stopped, a previously resolved user still resolves; one never resolved does
  not, and does again once the façade returns. That is offline *identity lookup*,
  not offline authentication — a distinction worth keeping straight, because only
  the first is delivered here.
- **A read-only projection is a small amount of code.** The façade is a few
  hundred lines of Go over `vjeantet/ldapserver` and `pgx/v5`.

## Costs and caveats found

- **The Go LDAP server library is old and has sharp edges.** Its accept loop
  dereferences the accepted connection *before* checking the accept error, so a
  wrapped listener returning `(nil, err)` panics it. `routes.Extended()` matches
  a single OID, so it cannot express "refuse all extended operations"; those have
  to fall through to a catch-all.
- **Its message library cannot decode extensible-match filters** as `go-ldap`
  encodes them (it demands `0xFF` for the `dnAttributes` boolean and rejects
  `0x01`). Such a request dies during decode, before any handler, so the client
  gets no response at all. SSSD does not send them, but a directory browser might.
- **`goldap` exposes no constructors for equality filters**, so filters can only
  be obtained by decoding wire bytes. The tests turn that into an advantage by
  building filters through a real encode/decode round trip.
- **Port 3389 is RDP.** The obvious "unprivileged LDAP" port collides with
  `gnome-remote-desktop`/`xrdp` on any developer desktop that has screen sharing
  on. The lab publishes on `127.0.0.1:23389` and keeps 3389 inside the network.

If this shape is productized, the library choice deserves revisiting before
anything else.

## Explicitly deferred

TLS/StartTLS, mTLS and device certificates, credential rotation, LDAP
authorization, rate limiting, HA/replication/failover, metrics, SSSD tuning and
cache policy, a UID allocation service, username rename semantics, LDAP paging,
multi-tenancy, and schema/version compatibility. Also PAM, SSH and any form of
user authentication — the next question after this one, and a separate
experiment.
