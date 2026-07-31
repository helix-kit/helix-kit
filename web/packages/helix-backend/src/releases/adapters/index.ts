import { esp32FirmwareAdapter } from './esp32-firmware';
import { linuxPackageAdapter } from './linux-package';
import { type ArtifactTypeAdapter } from './types';

// Data-driven type registry: artifact_type rows name an adapter via adapter_key; core code never branches on kind.
const adapters: readonly ArtifactTypeAdapter[] = [esp32FirmwareAdapter, linuxPackageAdapter];

export const adapterRegistry: ReadonlyMap<string, ArtifactTypeAdapter> = new Map(
  adapters.map((adapter) => [adapter.key, adapter]),
);

export const getAdapter = (adapterKey: string): ArtifactTypeAdapter => {
  const adapter = adapterRegistry.get(adapterKey);
  if (adapter === undefined) {
    throw new Error(`No artifact-type adapter registered for "${adapterKey}".`);
  }
  return adapter;
};

export * from './types';
