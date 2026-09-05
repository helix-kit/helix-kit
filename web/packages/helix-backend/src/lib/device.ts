import { and, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../db';

import { device } from '../db/schema';

const BEARER_PREFIX = 'Bearer ';

// Devices authenticate to the cloud with their access token as a bearer credential,
// the same way `helix-device`'s enrollment client sends it.
export const readBearerToken = (headers: Headers): string | null => {
  const headerValue = headers.get('authorization') ?? '';
  const matchedToken = headerValue.startsWith(BEARER_PREFIX)
    ? headerValue.slice(BEARER_PREFIX.length).trim()
    : '';
  return matchedToken === '' ? null : matchedToken;
};

export const verifyDeviceIdToken = async (
  deviceId: string,
  token: string,
  db: DatabaseClient,
): Promise<boolean> => {
  const devices = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.accessToken, token), eq(device.isActive, true), eq(device.id, deviceId)))
    .limit(1);
  const foundDevice = devices[0];
  return foundDevice !== undefined;
};
