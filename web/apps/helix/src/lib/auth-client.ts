'use client';

import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { env } from '@/lib/env';

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_BASE_URL,
  plugins: [adminClient(), passkeyClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
