import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),

    // Better Auth secret (required) and canonical origin (falls back to NEXT_PUBLIC_BASE_URL).
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.url().optional(),
    // Extra origins allowed to sign in, for reaching a dev server through a
    // tunnel. Development only; ignored in production, where the canonical
    // origin is the only one that may hold a session.
    DEV_ALLOWED_ORIGINS: z.string().optional(),

    // SMTP transport for auth mail; when unset the sender logs the action URL to
    // the console. SMTP_SERVER accepts a bare host or an smtp://|smtps:// URL.
    SMTP_SERVER: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SENDER: z.string().optional(),

    // When 'true', log the full rendered content of every outbound email. Testing aid.
    EMAIL_LOG_CONTENT: z.string().optional(),

    // step-ca connection for the admin cert-revocation surface. Optional: unset, cert
    // listing still works but the revoke mutation returns a clear error.
    MQTT_STEP_CA_URL: z.string().optional(),
    MQTT_STEP_CA_ROOT_CERT_PATH: z.string().optional(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_NAME: z.string().optional(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH: z.string().optional(),

    // ICE servers for the WebRTC (P2P) data plane. TURN is optional; without it,
    // peers with no direct path fail over to the relay. TURN_STATIC_AUTH_SECRET signs
    // per-user ephemeral credentials — without it TURN is treated as absent (never a
    // shared password, which would be an open relay).
    STUN_SERVER_URL: z.string().default('stun:stun.l.google.com:19302'),
    TURN_SERVER_URL: z.string().optional(),
    TURN_STATIC_AUTH_SECRET: z.string().optional(),
    // eslint-disable-next-line no-magic-numbers -- one hour
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    // Custom-firmware build service: the build container's URL, and the callback base
    // it reaches back on (must be reachable from the container). Both unset ⇒ the admin
    // firmware builder shows a "not configured" notice.
    HELIX_BUILD_WORKER_URL: z.string().optional(),
    HELIX_BUILD_CALLBACK_BASE_URL: z.string().optional(),

    // Vercel AI Gateway credentials for the site AI agent + MCP server. Without a
    // key the agent route returns a clear "not configured" error rather than 500ing.
    // AGENT_MODEL is a gateway model id (provider/model).
    AI_GATEWAY_API_KEY: z.string().optional(),
    AGENT_MODEL: z.string().default('deepseek/deepseek-v4-pro'),

    // Public CDN base for publicly-served assets (blog images). Objects under the
    // `public/` key prefix are fronted by CloudFront at this host; when set, uploads
    // return a stable `${STORAGE_PUBLIC_ASSET_URL}/<key-without-public/>` URL instead
    // of an expiring presigned one. Unset ⇒ fall back to presigned (dev/FS).
    STORAGE_PUBLIC_ASSET_URL: z.url().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  client: {
    // The single public origin (marketing, docs, blog, and product are one app).
    NEXT_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    NEXT_PUBLIC_HELIX_SOURCE_URL: z.url().default('https://github.com/helix-kit/helix-kit'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
    DEV_ALLOWED_ORIGINS: process.env['DEV_ALLOWED_ORIGINS'],
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
    STORAGE_PUBLIC_ASSET_URL: process.env['STORAGE_PUBLIC_ASSET_URL'],
    AI_GATEWAY_API_KEY: process.env['AI_GATEWAY_API_KEY'],
    AGENT_MODEL: process.env['AGENT_MODEL'],
    NODE_ENV: process.env['NODE_ENV'],
    NEXT_PUBLIC_BASE_URL: process.env['NEXT_PUBLIC_BASE_URL'],
    NEXT_PUBLIC_HELIX_SOURCE_URL: process.env['NEXT_PUBLIC_HELIX_SOURCE_URL'],
  },
  skipValidation:
    process.env['SKIP_ENV_VALIDATION'] !== undefined &&
    process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
});
