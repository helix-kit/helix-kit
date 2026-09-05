<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Experimental Helix PostgreSQL-backed LDAP + SSSD Integration

## 1. Objective

Build a completely isolated experimental implementation proving that Helix can expose its existing PostgreSQL-backed user identities to Linux through LDAP and SSSD.

This experiment must demonstrate the following end-to-end path:

```text
PostgreSQL
    |
    v
Custom Go LDAP Server
    |
    | LDAP
    v
SSSD inside Linux container
    |
    | NSS
    v
getent / id
```

The experiment must remain completely independent from the existing Helix codebase.

Do not integrate Better Auth, Helix authentication, PAM authentication, OAuth, device authentication, authorization, or production infrastructure.

The only goal is:

> Store minimal Helix user identity information in PostgreSQL, expose it through a custom LDAP server written in Go, configure SSSD to consume it, and prove that Linux resolves those users through NSS.

---

# 2. Scope

Implement three Docker services:

```text
postgres
helix-ldap
sssd-client
```

All services run on one private Docker Compose network.

Architecture:

```text
+-------------------+
| PostgreSQL        |
|                   |
| users table       |
+---------+---------+
          |
          | PostgreSQL protocol
          |
          v
+-------------------+
| helix-ldap        |
| Go                |
|                   |
| LDAP facade       |
+---------+---------+
          |
          | LDAP
          |
          v
+-------------------+
| sssd-client       |
| Linux container   |
|                   |
| SSSD              |
| NSS               |
| getent / id       |
+-------------------+
```

PostgreSQL is the only source of identity data.

The LDAP server must not maintain a second user database.

---

# 3. Explicit Non-Goals

Do NOT implement the following as part of this experiment:

- user password authentication
- Kerberos
- OAuth/OIDC
- PAM authentication
- SSH authentication
- Better Auth integration
- Helix authorization
- device authorization
- device certificates
- production-grade TLS
- offline login authentication
- LDAP password changes
- LDAP user creation
- LDAP user modification
- LDAP user deletion
- sudo rules
- application permissions
- Helix groups
- organization hierarchy
- production deployment
- Kubernetes
- integration with the main Helix database
- synchronization between LDAP and PostgreSQL

LDAP must be read-only.

The experiment is specifically about:

```text
Postgres -> LDAP -> SSSD -> NSS
```

---

# 4. Repository Layout

Create the experiment approximately as follows:

```text
experimental-ldap/
├── README.md
├── docker-compose.yml
├── .env.example
├── Makefile
│
├── go.mod
├── go.sum
│
├── cmd/
│   └── helix-ldap/
│       └── main.go
│
├── internal/
│   ├── config/
│   ├── identity/
│   ├── ldapserver/
│   └── store/
│       └── postgres/
│
├── migrations/
│   ├── 001_schema.sql
│   └── 002_seed.sql
│
├── docker/
│   ├── ldap/
│   │   └── Dockerfile
│   │
│   └── sssd-client/
│       ├── Dockerfile
│       ├── sssd.conf
│       └── entrypoint.sh
│
└── scripts/
    └── e2e.sh
```

Keep the implementation small.

Do not create generic abstraction frameworks unless needed by this experiment.

---

# 5. PostgreSQL Schema

Create exactly one application table:

```sql
CREATE TABLE users (
    uuid UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    linux_uid BIGINT NOT NULL UNIQUE
);
```

Do not add a separate group table.

Do not add password fields.

Do not add home directory or login shell columns.

Do not add timestamps unless required by tooling.

The `uuid` value represents the eventual foreign key to the real Helix users table.

For this experiment it is only a dummy UUID.

---

# 6. Username Rules

For the experiment, usernames must be valid Unix-style usernames.

Use a deliberately restrictive format:

```text
[a-z_][a-z0-9_-]{0,31}
```

Reject invalid usernames when inserting seed/test data.

Usernames should be treated as immutable for this experiment.

`linux_uid` must also be immutable after allocation.

Use UIDs beginning at:

```text
200001
```

to avoid collision with normal local/system users.

---

# 7. Seed Users

Seed at least:

```text
Alice

username:
alice

email:
alice@example.com

linux_uid:
200001
```

and:

```text
Bob

username:
bob

email:
bob@example.com

linux_uid:
200002
```

Use fixed dummy UUIDs so tests are deterministic.

Example:

```text
alice UUID:
00000000-0000-0000-0000-000000000001

bob UUID:
00000000-0000-0000-0000-000000000002
```

---

# 8. Unix Identity Projection

The database intentionally stores only:

```text
uuid
username
email
linux_uid
```

Everything else required by Linux must be synthesized by the LDAP service.

For user `alice`:

```text
uid             = alice
uidNumber       = 200001
gidNumber       = 200001
homeDirectory   = /home/alice
loginShell      = /usr/libexec/helix/session-launcher
cn              = alice
sn              = alice
mail            = alice@example.com
```

Use:

```text
gidNumber = uidNumber
```

for this experiment.

This models a private primary group per user without requiring another database table.

---

# 9. LDAP Directory Layout

Use:

```text
dc=helix,dc=local
```

as the naming context.

Users:

```text
ou=People,dc=helix,dc=local
```

Groups:

```text
ou=Groups,dc=helix,dc=local
```

Alice's LDAP DN:

```text
uid=alice,ou=People,dc=helix,dc=local
```

Alice's synthetic private group:

```text
cn=alice,ou=Groups,dc=helix,dc=local
```

---

# 10. LDAP User Entry

Expose a user similar to:

```text
dn: uid=alice,ou=People,dc=helix,dc=local

objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: inetOrgPerson
objectClass: posixAccount

uid: alice
cn: alice
sn: alice
mail: alice@example.com

uidNumber: 200001
gidNumber: 200001

homeDirectory: /home/alice
loginShell: /usr/libexec/helix/session-launcher
```

Do not expose a password.

Do not synthesize `userPassword`.

Authentication of human users is outside this experiment.

---

# 11. LDAP Group Entry

Since there is no groups table, synthesize one primary private group for every user.

Alice:

```text
dn: cn=alice,ou=Groups,dc=helix,dc=local

objectClass: top
objectClass: posixGroup

cn: alice
gidNumber: 200001
```

Bob:

```text
cn: bob
gidNumber: 200002
```

No supplementary group membership is required.

Do not invent Helix authorization groups.

---

# 12. Go LDAP Server Library

Use:

```text
github.com/vjeantet/ldapserver
```

for LDAP protocol/server functionality.

Do not manually implement:

- ASN.1 BER parsing
- LDAP framing
- LDAP request decoding
- LDAP response encoding
- raw LDAP TCP protocol

The project is intended for implementing custom LDAP servers/proxies and exposes handlers/routes for LDAP operations.

Use:

```text
github.com/jackc/pgx/v5
```

for PostgreSQL access.

Use a connection pool.

Use context-aware queries.

Use parameterized SQL only.

---

# 13. Internal Go Model

Create a domain model similar to:

```go
type UnixUser struct {
    UUID     uuid.UUID
    Email    string
    Username string
    UID      uint32
}
```

Derived methods/functions may provide:

```text
GID
HomeDirectory
LoginShell
LDAP DN
LDAP attributes
```

Do not mix SQL rows directly into LDAP handlers.

---

# 14. PostgreSQL Store Interface

Use a narrow interface approximately equivalent to:

```go
type UserStore interface {
    GetByUsername(ctx context.Context, username string) (*UnixUser, error)
    GetByUID(ctx context.Context, uid uint32) (*UnixUser, error)
    List(ctx context.Context, limit int) ([]UnixUser, error)
}
```

`List` exists only to support controlled LDAP enumeration/testing.

Set a strict upper limit.

Do not allow an LDAP query to cause an unbounded PostgreSQL query.

---

# 15. LDAP Operations to Support

Implement only what is required for LDAP discovery and SSSD identity resolution.

Required:

```text
Bind
Search
Unbind
Root DSE search
```

If the library handles Unbind internally, use its implementation.

Write operations must return an appropriate LDAP error such as:

```text
unwillingToPerform
```

for:

```text
Add
Modify
Delete
ModifyDN
```

---

# 16. LDAP Bind

For the experiment, configure one static SSSD service account.

Bind DN:

```text
cn=sssd,dc=helix,dc=local
```

Password:

```text
dev-only-password
```

The password must come from an environment variable in the Go service.

Do not hardcode it inside Go source.

Example:

```text
LDAP_BIND_DN=cn=sssd,dc=helix,dc=local
LDAP_BIND_PASSWORD=dev-only-password
```

SSSD should use this identity only to query the directory.

This bind account is NOT a Helix user.

It does not appear in PostgreSQL.

It must not resolve through NSS.

---

# 17. Anonymous Access

Allow anonymous Root DSE queries if useful for LDAP tooling.

Do not allow anonymous access to the People or Groups trees.

User/group searches should require the service bind.

---

# 18. Root DSE

Implement a basic Root DSE search for:

```text
base DN:
""

scope:
base

filter:
(objectClass=*)
```

Return at minimum useful metadata such as:

```text
namingContexts: dc=helix,dc=local
```

Optionally report supported LDAP version/capabilities supported by the selected library.

Do not advertise functionality that is not implemented.

---

# 19. Search Bases

Support:

```text
dc=helix,dc=local

ou=People,dc=helix,dc=local

ou=Groups,dc=helix,dc=local
```

Support base and subtree searches as needed by `ldapsearch` and SSSD.

---

# 20. Required User Searches

At minimum make these work:

```text
(uid=alice)
```

```text
(uidNumber=200001)
```

```text
(objectClass=posixAccount)
```

and common SSSD compound forms such as:

```text
(&(objectClass=posixAccount)(uid=alice))
```

```text
(&(objectClass=posixAccount)(uidNumber=200001))
```

SSSD uses LDAP to resolve POSIX users/groups and may generate compound LDAP filters rather than trivial single-attribute lookups.

---

# 21. Required Group Searches

Support:

```text
(cn=alice)
```

```text
(gidNumber=200001)
```

```text
(objectClass=posixGroup)
```

and corresponding AND/presence filters.

---

# 22. LDAP Filter Support

Do not write a general LDAP query language implementation from scratch if the selected library already exposes decoded filters.

Support enough filter semantics for SSSD:

```text
equality
presence
AND
OR
NOT
```

for attributes relevant to this experiment.

Relevant attributes:

```text
objectClass
uid
uidNumber
gidNumber
cn
mail
```

Unsupported filter forms should return a deterministic LDAP error or no matches rather than panic.

The server must never crash due to malformed filters.

---

# 23. Query Optimization

When possible, translate selective LDAP predicates directly to SQL:

```text
uid = X
    ->
WHERE username = $1
```

```text
uidNumber = N
    ->
WHERE linux_uid = $1
```

Do not load every user from PostgreSQL for these queries.

Enumeration queries may use:

```sql
ORDER BY linux_uid
LIMIT ...
```

with a strict server-side result limit.

For the experiment:

```text
maximum LDAP search results = 1000
```

is acceptable.

---

# 24. Timeouts and Resource Limits

Use reasonable defaults:

```text
PostgreSQL query timeout
LDAP connection read timeout
LDAP connection write timeout
LDAP search result limit
```

Exact values may be configurable, but do not build an elaborate configuration framework.

No individual LDAP request should be able to block forever.

---

# 25. Logging

Use structured logs where practical.

Log:

```text
LDAP connection opened
LDAP connection closed
bind success/failure
search base
search scope
filter
result count
query duration
errors
```

Never log:

```text
bind passwords
database passwords
raw credentials
```

---

# 26. Docker Compose

Create a Compose topology equivalent to:

```text
postgres
helix-ldap
sssd-client
```

Use a dedicated private Docker network.

The PostgreSQL port does not need to be exposed to the host unless useful for development.

The LDAP port may be exposed to the host for manual testing.

Use a non-privileged experimental LDAP port such as:

```text
3389
```

instead of requiring port 389.

---

# 27. PostgreSQL Container

Use an explicitly pinned supported PostgreSQL image.

Initialize:

```text
001_schema.sql
002_seed.sql
```

through Docker's initialization mechanism or an explicit migration step.

Configure:

```text
database = helix
user = helix
password = dev-only-password
```

for the experiment.

Do not treat these development credentials as production design.

Add a PostgreSQL health check using:

```text
pg_isready
```

---

# 28. Go LDAP Container

Use a multi-stage Docker build.

Builder stage:

```text
golang image
```

Runtime stage should be minimal.

The LDAP process must:

```text
run in foreground
handle SIGTERM
gracefully close listener
close PostgreSQL pool
exit cleanly
```

Do not daemonize inside the container.

---

# 29. SSSD Client Container

Build a Linux client container containing at minimum:

```text
sssd
SSSD LDAP provider
libnss-sss
ldapsearch client tooling
getent
id
```

An Ubuntu or Debian base is acceptable.

Systemd is NOT required for this experiment.

Run SSSD directly in the foreground/background from the container entrypoint.

The goal is to test:

```text
NSS -> SSSD -> LDAP
```

not systemd service integration.

---

# 30. `/etc/nsswitch.conf`

Configure:

```text
passwd: files sss
group:  files sss
shadow: files
```

Do not use SSSD for shadow/password authentication.

---

# 31. SSSD Configuration

Create approximately:

```ini
[sssd]
config_file_version = 2
services = nss
domains = helix

[domain/helix]
id_provider = ldap

ldap_uri = ldap://helix-ldap:3389
ldap_search_base = dc=helix,dc=local

ldap_user_search_base = ou=People,dc=helix,dc=local
ldap_group_search_base = ou=Groups,dc=helix,dc=local

ldap_schema = rfc2307

ldap_user_object_class = posixAccount
ldap_user_name = uid
ldap_user_uid_number = uidNumber
ldap_user_gid_number = gidNumber
ldap_user_home_directory = homeDirectory
ldap_user_shell = loginShell

ldap_group_object_class = posixGroup
ldap_group_name = cn
ldap_group_gid_number = gidNumber

ldap_default_bind_dn = cn=sssd,dc=helix,dc=local
ldap_default_authtok_type = password
ldap_default_authtok = dev-only-password

enumerate = false
cache_credentials = false
```

Exact options may need minor adjustment to the SSSD version used in the container.

The intended semantics must remain:

```text
LDAP is identity-only.
PAM/user password authentication is not involved.
```

Set:

```text
/etc/sssd/sssd.conf
```

permissions correctly, normally:

```text
0600
root:root
```

before starting SSSD.

---

# 32. Important SSSD Behavior

SSSD is expected to expose identities through NSS.

The primary integration tests must therefore use:

```text
getent
id
```

This matches the style used by SSSD's own identity testing utilities.

---

# 33. Direct LDAP Tests

Before testing SSSD, prove the custom LDAP server independently.

Example:

```bash
ldapsearch \
  -x \
  -H ldap://helix-ldap:3389 \
  -D 'cn=sssd,dc=helix,dc=local' \
  -w 'dev-only-password' \
  -b 'ou=People,dc=helix,dc=local' \
  '(&(objectClass=posixAccount)(uid=alice))'
```

Expected attributes include:

```text
uid: alice
uidNumber: 200001
gidNumber: 200001
homeDirectory: /home/alice
loginShell: /usr/libexec/helix/session-launcher
mail: alice@example.com
```

Also test:

```text
uidNumber lookup
nonexistent username
nonexistent UID
group lookup by cn
group lookup by gidNumber
Root DSE
bad bind password
anonymous protected search
```

---

# 34. SSSD Acceptance Tests

Once SSSD is running, the following must work inside `sssd-client`.

### Username lookup

```bash
getent passwd alice
```

Expected logically:

```text
alice:x:200001:200001:alice:/home/alice:/usr/libexec/helix/session-launcher
```

Exact GECOS formatting may vary.

### UID lookup

```bash
getent passwd 200001
```

Must resolve Alice.

### User identity

```bash
id alice
```

Must show:

```text
uid=200001(alice)
gid=200001(alice)
```

### Group by name

```bash
getent group alice
```

Must resolve:

```text
gid=200001
```

### Group by GID

```bash
getent group 200001
```

Must resolve Alice's synthetic primary group.

### Bob

Equivalent checks must succeed for:

```text
bob
200002
```

### Unknown user

```bash
getent passwd does-not-exist
```

must return no identity.

```bash
id does-not-exist
```

must fail.

---

# 35. Prove PostgreSQL Is the Source of Truth

Add a third user directly to PostgreSQL while everything is running.

Example:

```text
username = charlie
linux_uid = 200003
```

Do NOT restart the LDAP server.

Invalidate SSSD's cache if necessary.

Then:

```bash
getent passwd charlie
```

must return Charlie.

This proves:

```text
PostgreSQL
```

is being queried dynamically and there is no synchronized LDAP datastore.

Then delete Charlie from PostgreSQL, invalidate relevant SSSD cache, and verify:

```bash
getent passwd charlie
```

no longer resolves.

---

# 36. Test SSSD Identity Caching

This experiment should also demonstrate SSSD's local identity cache.

Procedure:

```text
1. Start all containers.

2. Resolve Alice:

   getent passwd alice

3. Confirm Alice is cached.

4. Stop helix-ldap.

5. Query Alice again:

   getent passwd alice

6. Verify the previously resolved identity can still be returned from SSSD cache.

7. Query a user that was never previously resolved.

8. Verify that uncached identity cannot be obtained while LDAP is unavailable.
```

This test is about:

```text
offline identity lookup
```

NOT:

```text
offline authentication
```

Do not confuse the two.

---

# 37. Unit Tests

Add Go tests for:

```text
Postgres row -> UnixUser mapping
UnixUser -> LDAP attributes
UID -> GID derivation
home directory derivation
login shell derivation
DN construction
username validation
LDAP filter handling
malformed LDAP inputs
unsupported write operations
bind success/failure
```

---

# 38. LDAP Integration Tests

Use a real LDAP client such as:

```text
github.com/go-ldap/ldap/v3
```

against an in-process or temporary instance of the LDAP server.

Do not test LDAP functionality only by invoking handler functions directly.

At minimum exercise:

```text
Bind
Root DSE
user Search
UID Search
group Search
unknown user
bad bind
```

The selected LDAP server library itself uses real-client end-to-end testing with `go-ldap`, so this is an appropriate pattern.

---

# 39. End-to-End Test Script

Create:

```text
scripts/e2e.sh
```

It must:

```text
docker compose build
docker compose up -d

wait for PostgreSQL
wait for LDAP

run direct ldapsearch tests

start/wait for SSSD

run getent tests
run id tests

perform dynamic PostgreSQL user test
perform SSSD cache/offline LDAP test

print PASS/FAIL summary
```

The script must exit non-zero on any failure.

Running one command should reproduce the experiment.

Prefer:

```bash
make test
```

which calls the script.

---

# 40. Diagnostics on Failure

If an SSSD test fails, automatically print:

```text
SSSD logs
LDAP service logs
PostgreSQL logs if relevant
/etc/sssd/sssd.conf
relevant /etc/nsswitch.conf lines
```

This is experimental infrastructure, so debugging visibility matters more than polished output.

---

# 41. Security Properties for the Experiment

Even though this is not production, retain these properties:

```text
SQL uses parameterized queries
LDAP cannot modify users
LDAP cannot change passwords
no user password exists in PostgreSQL
LDAP service bind secret is separate from users
unknown LDAP operations do not crash server
result sets are bounded
request processing has timeouts
credentials are not logged
```

---

# 42. Production Concerns Explicitly Deferred

Document these in the README but do not implement them yet:

```text
TLS / StartTLS
mTLS/device certificates
service-account credential rotation
production LDAP authorization
rate limiting
high availability
replication
multi-region deployment
database failover
observability
metrics
SSSD tuning
cache expiry policy
UID allocation service
username rename semantics
LDAP paging
large directories
multi-tenancy
schema/version compatibility
```

These are later design tasks.

---

# 43. Critical Architectural Invariant

This experiment must preserve:

```text
PostgreSQL = canonical data
LDAP       = protocol projection
SSSD       = Linux-side identity broker/cache
NSS        = Linux lookup interface
```

Do not introduce an LDAP-owned copy of users.

The intended flow is always:

```text
getent passwd alice

        |
        v

glibc NSS

        |
        v

libnss_sss

        |
        v

SSSD

        |
        v

LDAP search

        |
        v

helix-ldap

        |
        v

PostgreSQL

        |
        v

Alice
UID 200001
```

---

# 44. Definition of Done

The experiment is complete only when all of the following are demonstrated automatically:

```text
[PASS] PostgreSQL starts and seeds users.

[PASS] Go LDAP server connects to PostgreSQL.

[PASS] LDAP service bind succeeds.

[PASS] Invalid bind fails.

[PASS] ldapsearch resolves Alice by username.

[PASS] ldapsearch resolves Alice by UID.

[PASS] LDAP synthesizes Alice's private POSIX group.

[PASS] LDAP is read-only.

[PASS] SSSD starts successfully.

[PASS] NSS is configured with sss.

[PASS] getent passwd alice succeeds.

[PASS] getent passwd 200001 succeeds.

[PASS] id alice reports UID/GID 200001.

[PASS] getent group alice succeeds.

[PASS] Bob resolves as UID/GID 200002.

[PASS] nonexistent users fail cleanly.

[PASS] Adding a PostgreSQL row becomes visible through LDAP/SSSD without LDAP restart or data synchronization.

[PASS] Removing a PostgreSQL row is reflected after SSSD cache invalidation.

[PASS] Previously cached SSSD identity remains resolvable when the LDAP server is stopped.

[PASS] An identity never cached by SSSD cannot be newly discovered while LDAP is unavailable.

[PASS] `make test` runs the full experiment from a clean checkout.

[PASS] README explains how to inspect LDAP, SSSD logs, and PostgreSQL manually.
```

---

# 45. Deliverables

At completion, provide:

```text
working source code
go.mod/go.sum
Dockerfiles
docker-compose.yml
SQL schema and seed data
SSSD configuration
NSS configuration
unit tests
LDAP integration tests
end-to-end shell test
README
```

The README should contain a short architecture diagram and exact commands for:

```bash
make test

docker compose exec sssd-client getent passwd alice

docker compose exec sssd-client id alice
```

---

# 46. Implementation Priority

Implement incrementally in this order:

```text
Phase 1
PostgreSQL schema + repository

Phase 2
Go LDAP Bind + user Search

Phase 3
Direct ldapsearch tests

Phase 4
Synthetic POSIX groups

Phase 5
SSSD client container

Phase 6
getent/id integration

Phase 7
dynamic PostgreSQL mutation test

Phase 8
SSSD cached identity / LDAP outage test

Phase 9
hardening, cleanup, documentation
```

Do not start implementing PAM, SSH authentication, or Helix auth until this experiment is fully working.

The end state of this experiment should answer one question conclusively:

> **Can an ordinary Linux system use SSSD/NSS to resolve Helix users whose canonical identity records live only in PostgreSQL, through a lightweight custom Go LDAP façade?**

Nothing more is required in this phase.