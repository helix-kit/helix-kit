import { oAuthProtectedResourceMetadata } from 'better-auth/plugins';

import { auth } from '@/server/auth';

// RFC 9728 protected-resource metadata pointing MCP clients at the authorization
// server that guards /api/mcp.
export const GET = oAuthProtectedResourceMetadata(auth);
