import 'server-only';

import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import * as schema from '@helix/backend/db/auth-schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, mcp } from 'better-auth/plugins';

import AuthEmail from '@/emails/auth-email';
import { env } from '@/lib/env';

import { db } from './db';
import { sendEmail } from './send-email';

const SESSION_CACHE_MAX_AGE_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;

export const ADMIN_ROLES = ['admin', 'sysadmin'] as const;

const resolveBaseUrl = (): string => env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_BASE_URL;

const resolveTrustedOrigins = (): string[] => {
  if (env.NODE_ENV !== 'development') {
    return [env.NEXT_PUBLIC_BASE_URL];
  }

  // A dev server is often reached by a name other than the one it was
  // configured with — a tunnel, a LAN address, a phone. Better Auth rejects
  // those with `INVALID_ORIGIN`, which reads as "wrong password" from the form.
  const extra = (env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  return ['http://localhost:3000', env.NEXT_PUBLIC_BASE_URL, ...extra];
};

const createHelixAuth = () =>
  betterAuth({
    appName: 'helix',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: resolveBaseUrl(),
    trustedOrigins: resolveTrustedOrigins(),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    plugins: [
      admin({
        allowImpersonatingAdmins: true,
      }),
      passkey({
        rpID: env.NODE_ENV === 'development' ? 'localhost' : undefined,
      }),
      // Programmatic access for the external MCP server (x-api-key), scoped to the
      // minting user so each tool call still passes that user's own tRPC authz.
      apiKey(),
      // OAuth 2.1 authorization server for MCP clients (Claude Desktop, Cursor, …):
      // publishes the .well-known discovery docs and guards the MCP route via
      // withMcpAuth. Reuses the login page users already have.
      mcp({ loginPage: '/auth/login' }),
    ],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: SESSION_CACHE_MAX_AGE_MINUTES * SECONDS_PER_MINUTE,
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          [user.email],
          'Verify your email',
          AuthEmail({
            userName: user.name,
            actionUrl: url,
            previewText: 'Verify your Helix email',
            heading: 'Email verification',
            body: 'Please verify your email address to complete your registration.',
            buttonText: 'Verify Email',
          }),
        );
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          [user.email],
          'Reset your password',
          AuthEmail({
            userName: user.name,
            actionUrl: url,
            previewText: 'Reset your Helix password',
            heading: 'Password reset',
            body: 'Someone recently requested a password change for your Helix account. If this was you, you can set a new password here:',
            buttonText: 'Reset Password',
          }),
        );
      },
    },
  });

type HelixAuth = ReturnType<typeof createHelixAuth>;

const globalForAuth = globalThis as unknown as { helixAuth?: HelixAuth };

export const auth: HelixAuth = globalForAuth.helixAuth ?? createHelixAuth();

if (env.NODE_ENV !== 'production') {
  globalForAuth.helixAuth = auth;
}
