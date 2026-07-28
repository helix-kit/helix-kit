import { notFound } from 'next/navigation';

import { isDeviceAppAvailable } from '@helix/device-apps';

import { getDeviceApp } from '@/device-apps/registry';
import { resolveDeviceFeatureSet } from '@/device-apps/resolve';
import { fetchQuery } from '@/server/server';

import { DeviceAppFrame } from './device-app-frame';

const DeviceAppPage = async ({ params }: { params: Promise<{ id: string; app: string }> }) => {
  const { id, app: slug } = await params;
  const app = getDeviceApp(slug);
  if (app === null) {
    notFound();
  }

  const device = await fetchQuery((trpc) => trpc.devices.get.queryOptions({ id }));
  if (device === null) {
    notFound();
  }

  const features = await resolveDeviceFeatureSet(id);
  if (!isDeviceAppAvailable(app, features)) {
    notFound();
  }

  return (
    <DeviceAppFrame
      deviceId={id}
      deviceName={device.name}
      enabledFeatures={features.enabledKeys}
      slug={slug}
    />
  );
};

export default DeviceAppPage;
