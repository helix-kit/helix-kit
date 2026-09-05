'use client';

import { apiKeyClient } from '@better-auth/api-key/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient, deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { getBaseUrl } from '@/lib/getBaseUrl';

// Self-hosted: in the browser talk to the current origin (never a build-time
// baked-in NEXT_PUBLIC_BASE_URL), mirroring the tRPC client — see getBaseUrl.
export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [adminClient(), passkeyClient(), apiKeyClient(), deviceAuthorizationClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
