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

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`helix-linux-package selector requires "${field}".`);
  }
  return value.trim();
};

const optionalString = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : requireString(value, field);

type PackageEntry = {
  role: string;
  sha256: string;
  size: number;
  path?: string;
  url?: string;
};

// Every blob artifact on the variant is a package payload (typically a single .helixpkg, but the shape allows more).
const packageEntries = (
  artifacts: readonly AdapterArtifact[],
  urlFor?: Map<string, string>,
): PackageEntry[] =>
  artifacts
    .filter((artifact) => artifact.storageMode === 'blob' && artifact.sha256 !== null)
    .map((artifact) => ({
      role: artifact.role,
      sha256: artifact.sha256 as string,
      size: artifact.sizeBytes ?? 0,
      ...(artifact.path !== null ? { path: artifact.path } : {}),
      ...(urlFor?.has(artifact.role) === true ? { url: urlFor.get(artifact.role) } : {}),
    }));

const buildManifest = (args: ManifestBuildArgs, urlFor?: Map<string, string>) => ({
  name: args.release.name,
  version: args.release.version,
  arch: requireString(args.variant.selector.arch, 'arch'),
  ...(args.variant.selector.distro !== undefined
    ? { distro: requireString(args.variant.selector.distro, 'distro') }
    : {}),
  packages: packageEntries(args.artifacts, urlFor),
});

// helix-linux-package: content-addressed .helixpkg blobs selected by machine arch (and optional distro).
export const linuxPackageAdapter: ArtifactTypeAdapter = {
  key: 'helix-linux-package',

  canonicalizeSelector: (selector: Selector): Selector => {
    const arch = requireString(selector.arch, 'arch');
    const distro = optionalString(selector.distro, 'distro');
    return distro === undefined ? { arch } : { arch, distro };
  },

  computeConfigHash: (requestConfig): string =>
    sha256Hex(
      stableStringify({
        arch: requestConfig.arch ?? null,
        distro: requestConfig.distro ?? null,
        name: requestConfig.name ?? null,
      }),
    ),

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
        ...(artifact.path !== null ? { path: artifact.path } : {}),
      })),
      manifest: buildManifest(args, urlFor),
    };
  },
};
