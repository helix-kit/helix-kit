import { and, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../db';

import { device } from '../db/schema';

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
