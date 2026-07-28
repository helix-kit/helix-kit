import { createHash } from 'node:crypto';

import { type StorageSignedRequest } from '../../storage/interface';

export type Selector = Readonly<Record<string, unknown>>;

// A variant's artifact as the adapter sees it, independent of drizzle row typing.
export type AdapterArtifact = Readonly<{
  role: string;
  offset: string | null;
  path: string | null;
  storageMode: string; // 'blob' | 'ref'
  sha256: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  registry: string | null;
  coordinate: string | null;
  refVersion: string | null;
  digest: string | null;
  metadata: unknown;
}>;

// What a consumer gets back from resolution — either signed blob URLs or a registry coordinate.
export type ConsumerInstruction =
  | Readonly<{
      mode: 'blob';
      version: string;
      artifacts: ReadonlyArray<{
        role: string;
        url: string;
        sha256: string;
        size: number;
        offset?: string;
        path?: string;
      }>;
      manifest?: unknown;
    }>
  | Readonly<{
      mode: 'ref';
      registry: string;
      coordinate: string;
      version: string;
      digest: string;
      install: Readonly<Record<string, string>>;
    }>;

export type ManifestBuildArgs = Readonly<{
  release: Readonly<{ name: string; version: string; channel: string }>;
  variant: Readonly<{ selector: Selector; metadata?: unknown }>;
  artifacts: readonly AdapterArtifact[];
}>;

export type ResolveArgs = ManifestBuildArgs &
  Readonly<{ signUrl: (storageKey: string) => Promise<StorageSignedRequest> }>;

export interface ArtifactTypeAdapter {
  readonly key: string;
  // Validate + normalize a variant selector; the caller hashes the result.
  canonicalizeSelector(selector: Selector): Selector;
  // Tier-0 dedupe key for a custom-build request config.
  computeConfigHash(requestConfig: Readonly<Record<string, unknown>>): string;
  // Resolved install/flash manifest stored on variant.manifest (urls filled later).
  buildVariantManifest(args: ManifestBuildArgs): Record<string, unknown>;
  // Final consumer-facing instruction (signs blob URLs / emits ref coordinate).
  resolveConsumerInstruction(args: ResolveArgs): Promise<ConsumerInstruction>;
}

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

// Deterministic JSON with sorted object keys — stable hashing of selectors/config.
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
};

export const selectorHashOf = (selector: Selector): string => sha256Hex(stableStringify(selector));
