import { createOpenApiFetchHandler } from 'trpc-to-openapi';

import { createDeviceAuthContext, deviceAuthApiRouter } from '@/server/device-auth';

/**
 * The device-facing authorization and enrollment API.
 *
 * These are the same procedures the helix-server gateway exposes. They are served
 * here too because a device already has to reach this origin for the browser
 * sign-in flow, and giving it a second base URL to configure buys nothing.
 *
 * Authentication is the device's own access token, not a session: see the router.
 */
const handler = (request: Request): Promise<Response> =>
  createOpenApiFetchHandler({
    // The procedures declare their full paths (/api/device-auth/...), matching how
    // the helix-server gateway serves them, so nothing is stripped here.
    endpoint: '/',
    req: request,
    router: deviceAuthApiRouter,
    createContext: () => createDeviceAuthContext(request.headers),
  });

export { handler as GET, handler as POST };
