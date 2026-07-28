import { and, eq } from 'drizzle-orm';

import { getAdapter, selectorHashOf, type AdapterArtifact } from './adapters';
import { prefixedId } from './ids';

import { type DatabaseClient } from '../db';
import {
  artifact,
  artifactType,
  release,
  releaseChannelHead,
  variant,
  variantArtifact,
} from '../db/release-schema';
import { joinCasKey } from '../storage/object-keys';

type IngestBlobArtifact = Readonly<{
  role: string;
  offset?: string;
  path?: string;
  sha256: string;
  sizeBytes: number;
  contentType?: string;
  metadata?: Record<string, unknown>;
}>;

type IngestRefArtifact = Readonly<{
  role: string;
  offset?: string;
  path?: string;
  ref: Readonly<{
    registry: string;
    coordinate: string;
    refVersion: string;
    digest: string;
    metadata?: Record<string, unknown>;
  }>;
}>;

export type IngestArtifact = IngestBlobArtifact | IngestRefArtifact;

const isRefArtifact = (value: IngestArtifact): value is IngestRefArtifact => 'ref' in value;

type IngestVariant = Readonly<{
  selector: Record<string, unknown>;
  name?: string;
  analysis?: unknown;
  artifacts: readonly IngestArtifact[];
}>;

export type IngestReleaseDescriptor = Readonly<{
  typeKey: string;
  name: string;
  version: string;
  channel: string;
  sourceCommit?: string;
  sourceDirty?: boolean;
  config?: Record<string, unknown>;
  analysis?: unknown;
  publish?: boolean;
  variants: readonly IngestVariant[];
}>;

type IngestContext = Readonly<{
  ownerUserId: string | null;
  source: 'ci' | 'custom';
  buildId?: string;
}>;

type IngestResult = Readonly<{ releaseId: string; variantIds: string[] }>;

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const toAdapterArtifact = (input: IngestArtifact): AdapterArtifact => {
  const common = { role: input.role, offset: input.offset ?? null, path: input.path ?? null };
  if (isRefArtifact(input)) {
    return {
      ...common,
      storageMode: 'ref',
      sha256: null,
      sizeBytes: null,
      storageKey: null,
      registry: input.ref.registry,
      coordinate: input.ref.coordinate,
      refVersion: input.ref.refVersion,
      digest: input.ref.digest,
      metadata: input.ref.metadata ?? {},
    };
  }
  return {
    ...common,
    storageMode: 'blob',
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    storageKey: joinCasKey(input.sha256),
    registry: null,
    coordinate: null,
    refVersion: null,
    digest: null,
    metadata: input.metadata ?? {},
  };
};

// Select-then-insert keeps artifact rows unique without fighting partial-index ON CONFLICT inference.
const upsertArtifact = async (tx: Tx, typeKey: string, input: IngestArtifact): Promise<string> => {
  if (isRefArtifact(input)) {
    const [existing] = await tx
      .select({ id: artifact.id })
      .from(artifact)
      .where(
        and(
          eq(artifact.storageMode, 'ref'),
          eq(artifact.registry, input.ref.registry),
          eq(artifact.coordinate, input.ref.coordinate),
          eq(artifact.digest, input.ref.digest),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      return existing.id;
    }
    const id = prefixedId('art');
    await tx.insert(artifact).values({
      id,
      typeKey,
      storageMode: 'ref',
      metadata: input.ref.metadata ?? {},
      registry: input.ref.registry,
      coordinate: input.ref.coordinate,
      refVersion: input.ref.refVersion,
      digest: input.ref.digest,
      refMetadata: input.ref.metadata ?? null,
    });
    return id;
  }

  const [existing] = await tx
    .select({ id: artifact.id })
    .from(artifact)
    .where(and(eq(artifact.storageMode, 'blob'), eq(artifact.sha256, input.sha256)))
    .limit(1);
  if (existing !== undefined) {
    return existing.id;
  }
  const id = prefixedId('art');
  await tx.insert(artifact).values({
    id,
    typeKey,
    storageMode: 'blob',
    metadata: input.metadata ?? {},
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    storageKey: joinCasKey(input.sha256),
    contentType: input.contentType ?? null,
  });
  return id;
};

const upsertRelease = async (
  tx: Tx,
  descriptor: IngestReleaseDescriptor,
  context: IngestContext,
): Promise<string> => {
  const [existing] = await tx
    .select({ id: release.id })
    .from(release)
    .where(
      and(
        eq(release.typeKey, descriptor.typeKey),
        eq(release.name, descriptor.name),
        eq(release.version, descriptor.version),
      ),
    )
    .limit(1);
  if (existing !== undefined) {
    return existing.id;
  }
  const id = prefixedId('rel');
  await tx.insert(release).values({
    id,
    typeKey: descriptor.typeKey,
    name: descriptor.name,
    version: descriptor.version,
    channel: descriptor.channel,
    status: descriptor.publish === true ? 'ready' : 'draft',
    ownerUserId: context.ownerUserId,
    buildId: context.buildId ?? null,
    sourceCommit: descriptor.sourceCommit ?? null,
    sourceDirty: descriptor.sourceDirty ?? false,
    config: descriptor.config ?? {},
    analysis: descriptor.analysis ?? null,
    publishedAt: descriptor.publish === true ? new Date() : null,
  });
  return id;
};

const upsertVariant = async (
  tx: Tx,
  args: Readonly<{
    releaseId: string;
    selector: Record<string, unknown>;
    selectorHash: string;
    name?: string;
    analysis?: unknown;
    manifest: Record<string, unknown>;
    buildId?: string;
  }>,
): Promise<string> => {
  const [existing] = await tx
    .select({ id: variant.id })
    .from(variant)
    .where(and(eq(variant.releaseId, args.releaseId), eq(variant.selectorHash, args.selectorHash)))
    .limit(1);
  if (existing !== undefined) {
    return existing.id;
  }
  const id = prefixedId('var');
  await tx.insert(variant).values({
    id,
    releaseId: args.releaseId,
    selector: args.selector,
    selectorHash: args.selectorHash,
    name: args.name ?? null,
    manifest: args.manifest,
    analysis: args.analysis ?? null,
    buildId: args.buildId ?? null,
    status: 'ready',
  });
  return id;
};

const upsertVariantArtifact = async (
  tx: Tx,
  args: Readonly<{
    variantId: string;
    artifactId: string;
    role: string;
    offset: string | null;
    path: string | null;
  }>,
): Promise<void> => {
  const [existing] = await tx
    .select({ id: variantArtifact.id })
    .from(variantArtifact)
    .where(and(eq(variantArtifact.variantId, args.variantId), eq(variantArtifact.role, args.role)))
    .limit(1);
  if (existing !== undefined) {
    return;
  }
  await tx.insert(variantArtifact).values({
    id: prefixedId('vart'),
    variantId: args.variantId,
    artifactId: args.artifactId,
    role: args.role,
    offset: args.offset,
    path: args.path,
  });
};

const publishRelease = async (
  tx: Tx,
  descriptor: IngestReleaseDescriptor,
  releaseId: string,
): Promise<void> => {
  await tx
    .update(release)
    .set({ status: 'ready', publishedAt: new Date() })
    .where(eq(release.id, releaseId));

  const [head] = await tx
    .select({ id: releaseChannelHead.id })
    .from(releaseChannelHead)
    .where(
      and(
        eq(releaseChannelHead.typeKey, descriptor.typeKey),
        eq(releaseChannelHead.name, descriptor.name),
        eq(releaseChannelHead.channel, descriptor.channel),
      ),
    )
    .limit(1);
  if (head === undefined) {
    await tx.insert(releaseChannelHead).values({
      id: prefixedId('head'),
      typeKey: descriptor.typeKey,
      name: descriptor.name,
      channel: descriptor.channel,
      releaseId,
    });
  } else {
    await tx
      .update(releaseChannelHead)
      .set({ releaseId, updatedAt: new Date() })
      .where(eq(releaseChannelHead.id, head.id));
  }
};

// The single ingestion path for both CI register and custom-build callback; idempotent on natural keys.
export const ingestRelease = async (
  db: DatabaseClient,
  descriptor: IngestReleaseDescriptor,
  context: IngestContext,
): Promise<IngestResult> => {
  const [type] = await db
    .select({ adapterKey: artifactType.adapterKey, key: artifactType.key })
    .from(artifactType)
    .where(eq(artifactType.key, descriptor.typeKey))
    .limit(1);
  if (type === undefined) {
    throw new Error(`Unknown artifact type "${descriptor.typeKey}".`);
  }
  const adapter = getAdapter(type.adapterKey);

  return db.transaction(async (tx) => {
    const releaseId = await upsertRelease(tx, descriptor, context);
    const variantIds: string[] = [];

    for (const inputVariant of descriptor.variants) {
      const selector = adapter.canonicalizeSelector(inputVariant.selector);
      const selectorHash = selectorHashOf(selector);

      const links: Array<{
        artifactId: string;
        role: string;
        offset: string | null;
        path: string | null;
      }> = [];
      const adapterArtifacts: AdapterArtifact[] = [];
      for (const inputArtifact of inputVariant.artifacts) {
        const artifactId = await upsertArtifact(tx, type.key, inputArtifact);
        links.push({
          artifactId,
          role: inputArtifact.role,
          offset: inputArtifact.offset ?? null,
          path: inputArtifact.path ?? null,
        });
        adapterArtifacts.push(toAdapterArtifact(inputArtifact));
      }

      const manifest = adapter.buildVariantManifest({
        release: {
          name: descriptor.name,
          version: descriptor.version,
          channel: descriptor.channel,
        },
        variant: { selector },
        artifacts: adapterArtifacts,
      });

      const variantId = await upsertVariant(tx, {
        releaseId,
        selector,
        selectorHash,
        name: inputVariant.name,
        analysis: inputVariant.analysis,
        manifest,
        buildId: context.buildId,
      });
      for (const link of links) {
        await upsertVariantArtifact(tx, { variantId, ...link });
      }
      variantIds.push(variantId);
    }

    if (descriptor.publish === true) {
      await publishRelease(tx, descriptor, releaseId);
    }
    return { releaseId, variantIds };
  });
};
