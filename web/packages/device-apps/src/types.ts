import type { ComponentType } from 'react';

export type DeviceFeatureSet = Readonly<{
  isEnabled: (key: string) => boolean;
  enabledKeys: readonly string[];
}>;

export const createDeviceFeatureSet = (enabledKeys: Iterable<string>): DeviceFeatureSet => {
  const set = new Set(enabledKeys);
  return {
    isEnabled: (key) => set.has(key),
    enabledKeys: [...set],
  };
};

export type DeviceAppSurfaceProps = Readonly<{
  deviceId: string;
  enabledFeatures: readonly string[];
}>;

export type DeviceAppSurface = ComponentType<DeviceAppSurfaceProps>;

export type DeviceApp = Readonly<{
  slug: string;
  title: string;
  description?: string;
  requiredFeatures?: readonly string[];
  optionalFeatures?: readonly string[];
  isAvailable?: (features: DeviceFeatureSet) => boolean;
  fullBleed?: boolean;
  Surface: DeviceAppSurface;
}>;

export const isDeviceAppAvailable = (app: DeviceApp, features: DeviceFeatureSet): boolean => {
  if (app.isAvailable !== undefined) {
    return app.isAvailable(features);
  }
  return (app.requiredFeatures ?? []).every((key) => features.isEnabled(key));
};

export const deviceAppFeatureKeys = (app: DeviceApp): string[] => [
  ...new Set([...(app.requiredFeatures ?? []), ...(app.optionalFeatures ?? [])]),
];
