<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Experimental: PostgreSQL-backed LDAP + SSSD Linux identity

Can an ordinary Linux system resolve Helix users — whose canonical records live
**only** in PostgreSQL — as real Unix accounts, through a lightweight custom Go
LDAP façade?

**Yes.** `make test` proves it end to end, 44 checks, one command.

```
getent passwd alice
      |
      v
   glibc NSS  ->  libnss_sss  ->  SSSD  ->  LDAP search
                                              |
                                              v
                                         helix-ldap (Go)
                                              |
                                              v
                                          PostgreSQL
                                              |
                                              v
                                    alice, uid 200001
```

Three containers on one private network:

```
+-------------------+       +-------------------+       +-------------------+
|    postgres       |       |    helix-ldap     |       |   sssd-client     |
|                   | <---- |                   | <---- |                   |
|  users table      |  SQL  |  LDAP facade (Go) |  LDAP |  SSSD + NSS       |
|  (source of truth)|       |  read-only, :3389 |       |  getent / id      |
+-------------------+       +-------------------+       +-------------------+
```

This is a **lab**, fully isolated from the Helix codebase: its own Go module, its
own database, its own compose stack. It touches no Helix auth, no Better Auth, no
device certificates and no production infrastructure. The full brief is
[`SPEC.md`](./SPEC.md).

## The architectural invariant

```
PostgreSQL = canonical data
LDAP       = protocol projection
SSSD       = Linux-side identity broker and cache
NSS        = Linux lookup interface
```

There is **no LDAP-owned copy of users** and nothing to synchronize. The database
stores four columns:

```sql
uuid UUID, email TEXT, username TEXT, linux_uid BIGINT
```

Everything else Linux needs is synthesized per request by the façade
(`internal/identity`): `gidNumber` = `uidNumber` (a private primary group per
user, with no group table), `homeDirectory` = `/home/<username>`, `loginShell`,
the DNs, the objectClasses, and the `posixGroup` entry. Change a row in
PostgreSQL and the next lookup reflects it — no restart, no sync job. Phase 6 of
the e2e suite asserts exactly that.

No password is stored, projected, or accepted for a user. This directory
publishes **identity only**; authentication is out of scope.

## Run it

```sh
make test        # the whole experiment from a clean checkout: build, up, 44 checks
```

The stack is left running afterwards:

```sh
docker compose exec sssd-client getent passwd alice
docker compose exec sssd-client id alice
```

```
alice:*:200001:200001:alice:/home/alice:/usr/libexec/helix/session-launcher
uid=200001(alice) gid=200001(alice) groups=200001(alice)
```

Other targets: `make up`, `make down`, `make unit` (Go tests only, needs a host
Go toolchain), `make logs`, `make psql`, `make ldapsearch`, `make getent`.

## Inspect it by hand

**Query the façade directly.** ldapsearch lives in the client image; the
`--entrypoint` override runs it without starting SSSD:

```sh
docker compose run --rm --no-deps --entrypoint ldapsearch sssd-client \
  -x -LLL -H ldap://helix-ldap:3389 \
  -D 'cn=sssd,dc=helix,dc=local' -w 'dev-only-password' \
  -b 'ou=People,dc=helix,dc=local' '(&(objectClass=posixAccount)(uid=alice))'
```

```ldif
dn: uid=alice,ou=People,dc=helix,dc=local
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: inetOrgPerson
objectClass: posixAccount
uid: alice
cn: alice
sn: alice
gecos: alice
mail: alice@example.com
uidNumber: 200001
gidNumber: 200001
homeDirectory: /home/alice
loginShell: /usr/libexec/helix/session-launcher
```

From the host instead, the façade is published on **127.0.0.1:23389** (not 3389 —
that is RDP, and `gnome-remote-desktop`/`xrdp` commonly hold it; inside the
compose network it still listens on 3389 as the spec asks):

```sh
ldapsearch -x -LLL -H ldap://127.0.0.1:23389 \
  -D 'cn=sssd,dc=helix,dc=local' -w 'dev-only-password' \
  -b 'ou=Groups,dc=helix,dc=local' '(objectClass=posixGroup)'
```

**Read the logs.** The façade logs structured JSON — connection open/close, bind
outcome, search base/scope/filter/result count/duration. Credentials are never
logged.

```sh
docker compose logs -f helix-ldap
docker compose logs -f sssd-client          # SSSD runs in the foreground
docker compose logs postgres
```

Raise verbosity with `LDAP_WIRE_TRACE=true` (dumps raw packets) or
`SSSD_DEBUG_LEVEL=9` in `.env`, then `docker compose up -d`.

**Inspect the database.**

```sh
make psql
helix=# SELECT username, linux_uid FROM users ORDER BY linux_uid;
```

**Watch PostgreSQL drive the directory.** Add a row and resolve it, with no
restart and no synchronization:

```sh
docker compose exec -T postgres psql -U helix -d helix -c \
  "INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000009','eve@example.com','eve',200009);"
docker compose exec sssd-client getent passwd eve
```

**Inspect the client's configuration.**

```sh
docker compose exec sssd-client cat /etc/sssd/sssd.conf
docker compose exec sssd-client grep -E '^(passwd|group|shadow):' /etc/nsswitch.conf
docker compose exec sssd-client sss_cache -E      # invalidate the identity cache
```

## What the e2e suite proves

`scripts/e2e.sh` runs in seven phases and prints a PASS/FAIL summary, dumping
SSSD/LDAP/PostgreSQL logs and the effective SSSD and NSS configuration on any
failure.

| Phase | What it establishes |
| --- | --- |
| 1 | Go unit tests + in-process LDAP integration tests, driven by a real `go-ldap` client |
| 2 | PostgreSQL starts, seeds alice and bob; the façade connects to it |
| 3 | Direct LDAP: bind succeeds, bad bind and unknown bind DN fail, Root DSE, lookup by username and by uid, the synthesized private group, anonymous access to People denied, writes refused |
| 4 | The store package against live PostgreSQL: row→`UnixUser` mapping, not-found, ordering and bounds, parameterized queries |
| 5 | NSS: `getent passwd`/`getent group`/`id` for alice and bob, by name and by number; unknown identities fail cleanly |
| 6 | A row added to PostgreSQL resolves with no LDAP restart or sync; a row removed stops resolving after cache invalidation |
| 7 | With the façade stopped, a previously cached identity still resolves, one never cached does not, and it resolves again once the façade returns |

Phase 7 is about **offline identity lookup**, not offline authentication — there
is no authentication here to take offline.

## Layout

```
cmd/helix-ldap/         the service binary (foreground, graceful SIGTERM)
internal/config/        environment-driven configuration; secrets have no defaults
internal/identity/      UnixUser + the Unix/LDAP projection rules
internal/store/         the narrow read-only UserStore interface
internal/store/postgres pgx pool, parameterized, context-bounded, size-capped
internal/store/memstore in-memory store for the protocol tests
internal/ldapserver/    bind, search, Root DSE, filter matching, SQL pushdown
migrations/             001_schema.sql, 002_seed.sql (run by the postgres image)
docker/ldap/            multi-stage build, minimal runtime, non-root
docker/sssd-client/     Ubuntu + sssd/libnss-sss/ldap-utils, no systemd
scripts/e2e.sh          the whole experiment in one command
```

## Design notes

**Filters.** SSSD sends compound filters like
`(&(objectClass=posixAccount)(uid=alice))`. The façade evaluates equality,
presence, AND, OR and NOT against the projected entry, and separately plans a
single indexed SQL lookup from any equality predicate the filter *requires* —
the filter itself, or a direct child of a top-level AND. Predicates under an OR
or a NOT are optional, so pushing them into SQL could drop a matching row; those
fall back to bounded enumeration. Every candidate is then re-checked against the
full filter, so pushdown can neither widen nor narrow the result.

`uid=X` becomes `WHERE username = $1` and `uidNumber=N` becomes
`WHERE linux_uid = $1`. No LDAP query can cause an unbounded scan: enumeration is
`ORDER BY linux_uid LIMIT`, capped at `LDAP_SEARCH_LIMIT` (default 1000).

**Matching rules.** `objectClass` and `mail` compare case-insensitively;
`uidNumber`/`gidNumber` compare numerically; `uid` and `cn` compare
case-sensitively, so `getent passwd ALICE` does not resolve `alice`. Usernames
are lowercase by construction (`[a-z_][a-z0-9_-]{0,31}`, enforced in Go *and* by
a CHECK constraint).

**Unsupported filters** — substrings, `>=`, `<=`, `~=` — return
`unwillingToPerform` with a diagnostic rather than silently matching nothing. The
server never crashes on a malformed or unsupported filter.

**Writes.** Add, Modify, Delete, ModifyDN, Compare and every extended operation
(including StartTLS and password-modify) are refused with `unwillingToPerform`,
each with a response of the correct protocol type.

**Access.** Anonymous binds may read the Root DSE only; People and Groups require
the service bind, whose password comes from `LDAP_BIND_PASSWORD` and is never
hardcoded in Go or logged. The bind account is not a Helix user, has no row in
PostgreSQL, and does not resolve through NSS.

## Known limitations of the chosen libraries

Worth knowing before this shape is taken any further:

- **`vjeantet/ldapserver` dereferences the accepted connection before checking
  the accept error**, so returning `(nil, err)` from a wrapped listener panics
  its accept loop. `internal/ldapserver`'s listener parks that goroutine on
  shutdown instead; the process is exiting anyway.
- **`lor00x/goldap` cannot decode an extensible-match filter** (`(uid:dn:=alice)`)
  as `go-ldap` encodes it — it requires the `dnAttributes` boolean to be `0xFF`
  and rejects `0x01`. The request fails during decode, before any handler runs,
  so the client gets no response rather than a refusal. SSSD does not send these.
- **`goldap` exposes no constructors for `FilterEqualityMatch`** (its fields are
  unexported with no setters). The filter tests therefore build filters by
  encoding a real `SearchRequest` and decoding it — which is a better test
  anyway, since it exercises the same decode path as the wire.
- **`routes.Extended()` matches one OID at a time**, so it cannot express "refuse
  every extended operation". Those fall through to the catch-all handler.

## Deferred production concerns

Documented, deliberately **not** implemented here: TLS/StartTLS, mTLS and device
certificates, service-account credential rotation, production LDAP authorization,
rate limiting, high availability, replication, multi-region deployment, database
failover, observability and metrics, SSSD tuning, cache expiry policy, a UID
allocation service, username rename semantics, LDAP paging, large directories,
multi-tenancy, and schema/version compatibility.

Also out of scope by design: user password authentication, Kerberos, OAuth/OIDC,
PAM, SSH authentication, Better Auth integration, Helix authorization, device
authorization, offline login authentication, LDAP writes of any kind, sudo rules,
Helix groups and organization hierarchy.

The credentials in `.env.example` (`dev-only-password`) are development-only and
are not a production design.
