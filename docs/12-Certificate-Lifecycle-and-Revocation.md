<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 12 — Device Certificate Lifecycle and Revocation

## Why

Device identity on the data plane is an mTLS client certificate issued by the
Helix PKI (a smallstep **step-ca** instance). Until now the cloud minted these
certs as a stateless proxy: it signed a CSR through step-ca and handed the bundle
back, keeping **no record** of what was issued and offering **no way to revoke**.
An operator could not see how many certs a device held, when they were granted,
when they expire, and a leaked device key stayed valid for the cert's full
lifetime (24h default, up to 168h) with no recourse short of deleting the device.

This subsystem adds the missing lifecycle: every issued certificate is recorded,
and certificates can be **revoked natively via a CRL** that both the MQTT broker
and the mTLS gateway enforce.

## What is recorded

`device_certificate` (drizzle, `@helix/backend/db/schema`) stores one row per
issuance:

| column | meaning |
| --- | --- |
| `serial_number` | leaf serial (uppercase hex), unique |
| `fingerprint_sha256` | leaf SHA-256 fingerprint |
| `subject_common_name` | CN (the device id) |
| `not_before` / `not_after` | validity window parsed from the leaf |
| `issued_at` | when the cloud recorded it |
| `status` | `active` \| `revoked` (expiry is derived from `not_after`) |
| `revoked_at`, `revocation_reason`, `revoked_by_user_id` | set on revoke |

The row is written in `pkiRouter.issueDeviceCertificate` right after step-ca
signs the CSR: `parseCertificateMetadata` (`@helix/backend/pki/step-ca`) reads the
leaf with Node's `X509Certificate` and the row is inserted (`onConflictDoNothing`
on the serial, so re-issuance is idempotent).

## Admin surface

`deviceCertificatesAdminRouter` (`@helix/backend/pki/admin-router`, mounted as
`deviceCertificates` in the core app) exposes:

- `list({ deviceId })` — every certificate for a device, newest first, with a
  folded `state` (`active`/`revoked`/`expired`).
- `revoke({ certificateId, reason })` — admin-gated. Calls step-ca's
  `/1.0/revoke` (passive, provisioner-signed OTT) to put the serial on the CRL,
  then marks the row `revoked`.

The **Certificates** panel on `/device/[id]` (`device-certificates.tsx`) renders
the list and a revoke action for admins.

## Native revocation via CRL

step-ca is the only holder of the intermediate CA key, so it alone can sign the
CRL of revoked leaves. Revocation is therefore native:

1. **step-ca** is configured with `crl.enabled = true`, a persistent `db`
   (badgerv2), and a `cacheDuration` — see the `ca.json` patch in
   `cloud/appliance/bin/pki-init.sh` and `cloud/bootstrap-step-ca.sh`. It serves
   the signed CRL at `/crl` and regenerates it proactively on the
   `cacheDuration` cadence (so a revoke lands within that window; the appliance
   uses `2m`).
2. **Revoke** (`revokeDeviceCertificate`) mints a provisioner-signed revoke token
   and POSTs `/1.0/revoke`; the serial joins the CRL.
3. **crl-sync** (`cloud/appliance/bin/crl-sync.sh`, the `helix-crl-sync` systemd
   service) fetches `/crl`, converts DER→PEM, **appends the root CRL** (see
   below), and stages it into the mosquitto + helix-server cert dirs, reloading
   mosquitto (SIGHUP) when it changes. mosquitto's initial CRL is staged
   (`crl-sync.sh once`) in its `ExecStartPre` so the listener never binds without
   one (fail closed).
4. **Enforcement:**
   - **mosquitto** — `crlfile` on the **device** listener (8883) only; internal
     services on the service listener (8884) use long-lived, directly-issued
     certs and are not CRL-checked. A revoked serial fails the handshake.
   - **mTLS gateway** — `buildMTLSServer` passes the CRLs into the TLS
     `SecureContext` and watches the file, hot-reloading via `setSecureContext`
     so revocations apply without a restart (`DEVICE_MTLS_CRL_PATH`).

Because device certs are short-lived, an unrevoked cert also disappears on its
own within its TTL; the CRL closes the window in between.

### Two OpenSSL gotchas this had to solve

- **CRL scope.** step-ca stamps a critical *Issuing Distribution Point*
  (`https://localhost/1.0/crl`) on the CRL. OpenSSL then rejects any cert whose
  *CRL Distribution Points* don't match — i.e. every cert — with "different CRL
  scope". Fix: the `helix-device` provisioner uses an x509 **template**
  (`device-leaf.tpl`) that stamps a matching `crlDistributionPoints` on issued
  device leaves.
- **CRL_CHECK_ALL.** Node's `crl` TLS option runs OpenSSL with
  `X509_V_FLAG_CRL_CHECK_ALL`, which demands a CRL for *every* cert in the chain
  — including the intermediate, whose CRL is issued by the root. step-ca only
  serves the intermediate's CRL, so `pki-init.sh` generates an empty, long-lived
  **root-signed CRL** (`root_crl.pem`) and crl-sync appends it. (mosquitto checks
  leaf-only, so it needs only step-ca's CRL, but the extra one is harmless.) The
  gateway splits the multi-CRL file and passes an array to Node, which otherwise
  loads only the first CRL from a buffer.

### Distribution paths

| deployment | broker CRL | gateway CRL |
| --- | --- | --- |
| appliance (canonical) | `helix-crl-sync` daemon → `crlfile` (8883) + SIGHUP | `helix-crl-sync` writes the watched file → `setSecureContext` |
| docker-compose | mosquitto entrypoint fetch loop → `crlfile` (8883) + SIGHUP | — (deferred; set `DEVICE_MTLS_CRL_PATH` + supply the concatenated CRL to enable) |

## Testing

`tests/e2e/test_cert_revocation.py` provisions a device, asserts the
`device_certificate` row, confirms the cert works over MQTT **and** the mTLS
gateway, then revokes the serial (via step-ca), waits for the CRL to regenerate,
and asserts **both** enforcers now reject the same cert. Verified end-to-end on a
freshly built appliance alongside the device-events, HTTP-ingestion, and gateway
suites (no regression from the `crlfile`). The CRL config lives in the image, so
run against a freshly built one.

Because the CRL is baked into the image, testing it needs a fresh appliance. To
avoid disturbing a running one, `helix appliance up --port-base <N>` brings up a
second appliance whose host ports are `N+1, N+2, …` (container/volume suffixed
with `N`), and the e2e harness targets it via `HELIX_E2E_PORT_BASE` (+
`HELIX_E2E_REUSE=1` to reuse an already-running instance).
