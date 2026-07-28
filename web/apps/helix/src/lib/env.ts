import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),

    // Better Auth session-signing secret and canonical origin. The secret is
    // required; the URL falls back to NEXT_PUBLIC_BASE_URL when unset.
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.url().optional(),

    // SMTP transport for verification / password-reset mail. When unset the
    // sender logs the action URL to the server console instead (dev fallback).
    // SMTP_SERVER accepts a bare host or an smtp://|smtps:// URL.
    SMTP_SERVER: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SENDER: z.string().optional(),

    // When 'true', log the full rendered content (recipients, subject, text,
    // html) of every outbound email via the winston logger. Testing aid — the
    // appliance dev env enables it by default so verification / reset links are
    // readable straight from the server logs without a mail server.
    EMAIL_LOG_CONTENT: z.string().optional(),

    // step-ca connection for the admin certificate-revocation surface. Optional:
    // when unset, cert listing still works (DB read) but the revoke mutation
    // returns a clear error. The appliance dev env provisions all four, reusing
    // the same names helix-server uses so the PKI wiring is identical.
    MQTT_STEP_CA_URL: z.string().optional(),
    MQTT_STEP_CA_ROOT_CERT_PATH: z.string().optional(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_NAME: z.string().optional(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH: z.string().optional(),

    // ICE servers for the WebRTC (P2P) data plane, served to the browser by the
    // `ice.config` procedure. STUN has a public default; TURN is optional — with
    // no TURN, peers that cannot find a direct path simply fail over to the
    // relayed data plane, which always works.
    //
    // TURN_STATIC_AUTH_SECRET signs the short-lived credentials we mint per user
    // (coturn's use-auth-secret model). Without it, TURN is treated as absent —
    // we never fall back to a shared password, which would be an open relay.
    STUN_SERVER_URL: z.string().default('stun:stun.l.google.com:19302'),
    TURN_SERVER_URL: z.string().optional(),
    TURN_STATIC_AUTH_SECRET: z.string().optional(),
    // eslint-disable-next-line no-magic-numbers -- one hour
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    // Custom-firmware build service. HELIX_BUILD_WORKER_URL is the long-running
    // build container (its GET /catalog + POST /build).
    // HELIX_BUILD_CALLBACK_BASE_URL is the release-backend base the container
    // calls back to ({url}/api/build/*) — usually helix-server's public URL, and
    // it must be reachable *from the container* (e.g. http://host.docker.internal:4000
    // when the container runs under docker-compose against a host helix-server).
    // Both unset ⇒ the admin firmware builder shows a "not configured" notice.
    HELIX_BUILD_WORKER_URL: z.string().optional(),
    HELIX_BUILD_CALLBACK_BASE_URL: z.string().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  client: {
    // The single public origin. The marketing site, the docs, the blog and the
    // product are now ONE app on ONE origin, so the old split of
    // NEXT_PUBLIC_SITE_URL (website) / NEXT_PUBLIC_APP_URL (helix) collapsed into
    // this: they would all have held the same value.
    NEXT_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    NEXT_PUBLIC_HELIX_SOURCE_URL: z.url().default('https://github.com/helix-kit/helix-kit'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
    SMTP_SERVER: process.env['SMTP_SERVER'],
    SMTP_USER: process.env['SMTP_USER'],
    SMTP_PASSWORD: process.env['SMTP_PASSWORD'],
    SMTP_SENDER: process.env['SMTP_SENDER'],
    EMAIL_LOG_CONTENT: process.env['EMAIL_LOG_CONTENT'],
    MQTT_STEP_CA_URL: process.env['MQTT_STEP_CA_URL'],
    MQTT_STEP_CA_ROOT_CERT_PATH: process.env['MQTT_STEP_CA_ROOT_CERT_PATH'],
    MQTT_STEP_CA_DEVICE_PROVISIONER_NAME: process.env['MQTT_STEP_CA_DEVICE_PROVISIONER_NAME'],
    MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH:
      process.env['MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH'],
    STUN_SERVER_URL: process.env['STUN_SERVER_URL'],
    TURN_SERVER_URL: process.env['TURN_SERVER_URL'],
    TURN_STATIC_AUTH_SECRET: process.env['TURN_STATIC_AUTH_SECRET'],
    TURN_CREDENTIAL_TTL_SECONDS: process.env['TURN_CREDENTIAL_TTL_SECONDS'],
    HELIX_BUILD_WORKER_URL: process.env['HELIX_BUILD_WORKER_URL'],
    HELIX_BUILD_CALLBACK_BASE_URL: process.env['HELIX_BUILD_CALLBACK_BASE_URL'],
    NODE_ENV: process.env['NODE_ENV'],
    NEXT_PUBLIC_BASE_URL: process.env['NEXT_PUBLIC_BASE_URL'],
    NEXT_PUBLIC_HELIX_SOURCE_URL: process.env['NEXT_PUBLIC_HELIX_SOURCE_URL'],
  },
  skipValidation:
    process.env['SKIP_ENV_VALIDATION'] !== undefined &&
    process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
});
