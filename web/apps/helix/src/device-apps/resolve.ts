import 'server-only';

import { resolveDeviceFeatures } from '@helix/backend/features';
import { createDeviceFeatureSet, type DeviceFeatureSet } from '@helix/device-apps';

import { db } from '@/server/db';

export const resolveDeviceFeatureSet = async (deviceId: string): Promise<DeviceFeatureSet> => {
  const resolved = await resolveDeviceFeatures(db, deviceId);
  const enabled = [...resolved.entries()]
    .filter(([, resolution]) => resolution.enabled)
    .map(([key]) => key);
  return createDeviceFeatureSet(enabled);
};
