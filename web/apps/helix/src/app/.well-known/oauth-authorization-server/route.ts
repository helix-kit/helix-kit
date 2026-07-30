import { oAuthDiscoveryMetadata } from 'better-auth/plugins';

import { auth } from '@/server/auth';

// MCP clients discover the authorization server at the root well-known path; the
// Better Auth mcp plugin serves the metadata (it lives under /api/auth otherwise).
export const GET = oAuthDiscoveryMetadata(auth);
