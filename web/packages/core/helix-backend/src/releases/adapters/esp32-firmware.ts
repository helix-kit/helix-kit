import {
  sha256Hex,
  stableStringify,
  type AdapterArtifact,
  type ArtifactTypeAdapter,
  type ConsumerInstruction,
  type ManifestBuildArgs,
  type ResolveArgs,
  type Selector,
} from './types';

const DEFAULT_BAUD_RATE = 460800;
const DEFAULT_FLASH_MODE = 'dio';
const DEFAULT_FLASH_FREQ = '80m';
const HEX_RADIX = 16;

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`esp32-firmware selector requires "${field}".`);
  }
  return value.trim();
};

// Roles that flash to the device, in flash order.
const FLASH_ROLES = ['bootloader', 'partition-table', 'ota-data', 'app'] as const;

type ManifestArtifact = {
  id: string;
  name: string;
  offset: number;
  sha256: string;
  size: number;
  url?: string;
};

const manifestArtifacts = (
  artifacts: readonly AdapterArtifact[],
  urlFor?: Map<string, string>,
): ManifestArtifact[] =>
  FLASH_ROLES.flatMap((role) => {
    const artifact = artifacts.find((candidate) => candidate.role === role);
    if (artifact?.offset == null || artifact.sha256 == null) {
      return [];
    }
    return [
      {
        id: role,
        name: `${role}.bin`,
        offset: Number.parseInt(artifact.offset, HEX_RADIX),
        sha256: artifact.sha256,
        size: artifact.sizeBytes ?? 0,
        ...(urlFor?.has(role) === true ? { url: urlFor.get(role) } : {}),
      },
    ];
  });

const buildManifest = (args: ManifestBuildArgs, urlFor?: Map<string, string>) => {
  const chip = requireString(args.variant.selector.chip, 'chip');
  const flashSize = requireString(args.variant.selector.flashSize, 'flashSize');
  return {
    chip,
    baudRate: DEFAULT_BAUD_RATE,
    flashMode: DEFAULT_FLASH_MODE,
    flashFreq: DEFAULT_FLASH_FREQ,
    flashSize,
    version: args.release.version,
    artifacts: manifestArtifacts(args.artifacts, urlFor),
  };
};

// esp32-firmware: content-addressed blobs (bootloader/partition-table/ota-data/app)
// with flash offsets; the resolved manifest is the browser flasher's shape.
export const esp32FirmwareAdapter: ArtifactTypeAdapter = {
  key: 'esp32-firmware',

  canonicalizeSelector: (selector: Selector): Selector => {
    const chip = requireString(selector.chip, 'chip');
    const flashSize = requireString(selector.flashSize, 'flashSize');
    const featureSet =
      selector.featureSet === undefined || selector.featureSet === null
        ? undefined
        : requireString(selector.featureSet, 'featureSet');
    return featureSet === undefined ? { chip, flashSize } : { chip, flashSize, featureSet };
  },

  computeConfigHash: (requestConfig): string => {
    const apps = Array.isArray(requestConfig.apps)
      ? [...(requestConfig.apps as string[])].sort()
      : [];
    const features = Array.isArray(requestConfig.features)
      ? [...(requestConfig.features as string[])].sort()
      : [];
    const canonical = {
      apps,
      chip: requestConfig.chip ?? null,
      features,
      flashSize: requestConfig.flashSize ?? null,
      set: requestConfig.set ?? {},
    };
    return sha256Hex(stableStringify(canonical));
  },

  buildVariantManifest: (args): Record<string, unknown> => buildManifest(args),

  resolveConsumerInstruction: async (args: ResolveArgs): Promise<ConsumerInstruction> => {
    const signed = await Promise.all(
      args.artifacts
        .filter((artifact) => artifact.storageMode === 'blob' && artifact.storageKey !== null)
        .map(async (artifact) => {
          const request = await args.signUrl(artifact.storageKey as string);
          return { artifact, url: request.url };
        }),
    );
    const urlFor = new Map(signed.map(({ artifact, url }) => [artifact.role, url]));
    return {
      mode: 'blob',
      version: args.release.version,
      artifacts: signed.map(({ artifact, url }) => ({
        role: artifact.role,
        url,
        sha256: artifact.sha256 ?? '',
        size: artifact.sizeBytes ?? 0,
        ...(artifact.offset !== null ? { offset: artifact.offset } : {}),
      })),
      manifest: buildManifest(args, urlFor),
    };
  },
};
