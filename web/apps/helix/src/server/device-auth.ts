import 'server-only';

import {
  deviceAuthApiRouter as apiRouter,
  EnrollmentRelay,
  fixtureFromEnv,
  type DeviceAuthContext,
} from '@helix-hq/backend/device-auth';
import { createRootRouter } from '@helix-hq/backend/trpc';

import { env } from '@/lib/env';

import { db } from './db';

/**
 * The experimental device-login authorization fixture, and the relay that carries
 * a pending credential to its owner's browser.
 *
 * One of each per process, so a scope changed through one surface is seen by the
 * next request through another. With no fixture configured the provider holds no
 * grants, and therefore authorizes nobody.
 */
export const deviceAuthorization = fixtureFromEnv(env.DEVICE_AUTH_FIXTURE);
export const deviceEnrollments = new EnrollmentRelay();

const { router } = createRootRouter({ deviceAuth: apiRouter });

export const deviceAuthApiRouter = router;

export const createDeviceAuthContext = (headers: Headers): DeviceAuthContext => ({
  db,
  headers,
  authorization: deviceAuthorization,
  directory: deviceAuthorization,
  enrollments: deviceEnrollments,
  enrollmentVerificationUri: `${env.NEXT_PUBLIC_BASE_URL}/device/enroll`,
});
