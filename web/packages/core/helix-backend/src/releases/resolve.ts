import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { type DatabaseClient } from '../db';
import {
  artifact,
  deviceProfile,
  profileTrack,
  release,
  releaseChannelHead,
  variant,
  variantArtifact,
} from '../db/release-schema';

type ResolvedArtifact = Readonly<{
  role: string;
  offset: string | null;
  storageMode: string;
  storageKey: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  releaseId: string;
  releaseVersion: string;
  variantId: string;
  typeKey: string;
}>;

// A profile_track row (drizzle-inferred shape).
type Track = typeof profileTrack.$inferSelect;

export type ResolvedTrackArtifact = Readonly<{
  role: string;
  offset: string | null;
  storageMode: string;
  storageKey: string | null;
  sha256: string | null;
  sizeBytes: number | null;
}>;

// The rich resolution of a single track: which release + variant it lands on (or
// why it doesn't), plus the artifacts that variant carries.
export type TrackResolution = Readonly<{
  // 'no-release' = no pin and no channel head; 'no-variant' = release found but no
  // ready variant matches the selector; 'resolved' = fully resolved.
  status: 'resolved' | 'no-release' | 'no-variant';
  source: 'pinned' | 'channel' | null;
  release: Readonly<{
    id: string;
    name: string;
    version: string;
    channel: string;
    status: string;
  }> | null;
  variant: Readonly<{ id: string; name: string | null; selector: unknown }> | null;
  artifacts: ResolvedTrackArtifact[];
}>;

// Resolve one track: pinned release or channel head → release → matching ready
// variant (GIN `@>` containment on the selector) → its artifacts.
export const resolveTrack = async (db: DatabaseClient, track: Track): Promise<TrackResolution> => {
  let releaseId: string | null = track.pinnedReleaseId;
  let source: 'pinned' | 'channel' | null = track.pinnedReleaseId === null ? null : 'pinned';
  if (releaseId === null && track.channel !== null) {
    const [head] = await db
      .select({ releaseId: releaseChannelHead.releaseId })
      .from(releaseChannelHead)
      .where(
        and(
          eq(releaseChannelHead.typeKey, track.typeKey),
          eq(releaseChannelHead.name, track.releaseName),
          eq(releaseChannelHead.channel, track.channel),
        ),
      )
      .limit(1);
    releaseId = head?.releaseId ?? null;
    source = releaseId === null ? null : 'channel';
  }
  if (releaseId === null) {
    return { status: 'no-release', source: null, release: null, variant: null, artifacts: [] };
  }

  const [releaseRow] = await db
    .select({
      id: release.id,
      name: release.name,
      version: release.version,
      channel: release.channel,
      status: release.status,
    })
    .from(release)
    .where(eq(release.id, releaseId))
    .limit(1);
  if (releaseRow === undefined) {
    return { status: 'no-release', source: null, release: null, variant: null, artifacts: [] };
  }

  const selector = (track.selector ?? {}) as Record<string, unknown>;
  const [matchedVariant] = await db
    .select({ id: variant.id, name: variant.name, selector: variant.selector })
    .from(variant)
    .where(
      and(
        eq(variant.releaseId, releaseId),
        eq(variant.status, 'ready'),
        sql`${variant.selector} @> ${JSON.stringify(selector)}::jsonb`,
      ),
    )
    .orderBy(desc(variant.createdAt))
    .limit(1);
  if (matchedVariant === undefined) {
    return { status: 'no-variant', source, release: releaseRow, variant: null, artifacts: [] };
  }

  const artifacts = await db
    .select({
      role: variantArtifact.role,
      offset: variantArtifact.offset,
      storageMode: artifact.storageMode,
      storageKey: artifact.storageKey,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    })
    .from(variantArtifact)
    .innerJoin(artifact, eq(variantArtifact.artifactId, artifact.id))
    .where(eq(variantArtifact.variantId, matchedVariant.id));

  return { status: 'resolved', source, release: releaseRow, variant: matchedVariant, artifacts };
};

const tracksForDevice = async (db: DatabaseClient, deviceId: string): Promise<Track[]> => {
  const profiles = await db
    .select({ profileId: deviceProfile.profileId })
    .from(deviceProfile)
    .where(eq(deviceProfile.deviceId, deviceId));
  if (profiles.length === 0) {
    return [];
  }
  return db
    .select()
    .from(profileTrack)
    .where(
      inArray(
        profileTrack.profileId,
        profiles.map((row) => row.profileId),
      ),
    );
};

// Every artifact a device is allowed to run: device → device_profile →
// profile_track → resolveTrack → artifacts (the OTA/download authorization set).
const resolveDeviceArtifacts = async (
  db: DatabaseClient,
  deviceId: string,
): Promise<ResolvedArtifact[]> => {
  const tracks = await tracksForDevice(db, deviceId);
  const resolved: ResolvedArtifact[] = [];
  for (const track of tracks) {
    const result = await resolveTrack(db, track);
    if (result.status !== 'resolved' || result.release === null || result.variant === null) {
      continue;
    }
    for (const row of result.artifacts) {
      resolved.push({
        ...row,
        releaseId: result.release.id,
        releaseVersion: result.release.version,
        variantId: result.variant.id,
        typeKey: track.typeKey,
      });
    }
  }
  return resolved;
};

// The set of blob storage keys a device may fetch — the authorization set for the
// profile-gated download session.
export const resolveDeviceAllowedKeys = async (
  db: DatabaseClient,
  deviceId: string,
): Promise<Set<string>> => {
  const resolved = await resolveDeviceArtifacts(db, deviceId);
  return new Set(
    resolved
      .filter((entry) => entry.storageMode === 'blob' && entry.storageKey !== null)
      .map((entry) => entry.storageKey as string),
  );
};

type OtaTarget = Readonly<{
  storageKey: string;
  sha256: string;
  version: string;
  releaseId: string;
  variantId: string;
}>;

// The OTA update target for a device: the resolved `app` blob (path + sha256 +
// version) that the OTA producer advertises and the device then fetches.
export const resolveOtaTarget = async (
  db: DatabaseClient,
  deviceId: string,
): Promise<OtaTarget | null> => {
  const resolved = await resolveDeviceArtifacts(db, deviceId);
  const app = resolved.find(
    (entry) => entry.role === 'app' && entry.storageMode === 'blob' && entry.storageKey !== null,
  );
  if (app === undefined) {
    return null;
  }
  if (app.storageKey === null || app.sha256 === null) {
    return null;
  }
  return {
    storageKey: app.storageKey,
    sha256: app.sha256,
    version: app.releaseVersion,
    releaseId: app.releaseId,
    variantId: app.variantId,
  };
};

// Per-track resolution for a whole profile — backs the admin "what does this
// profile resolve to" preview.
export const resolveProfileTracks = async (
  db: DatabaseClient,
  profileId: string,
): Promise<Array<{ track: Track; resolution: TrackResolution }>> => {
  const tracks = await db.select().from(profileTrack).where(eq(profileTrack.profileId, profileId));
  const out: Array<{ track: Track; resolution: TrackResolution }> = [];
  for (const track of tracks) {
    out.push({ track, resolution: await resolveTrack(db, track) });
  }
  return out;
};

// Per-track resolution across all of a device's assigned profiles.
export const resolveDeviceTracks = async (
  db: DatabaseClient,
  deviceId: string,
): Promise<Array<{ track: Track; resolution: TrackResolution }>> => {
  const tracks = await tracksForDevice(db, deviceId);
  const out: Array<{ track: Track; resolution: TrackResolution }> = [];
  for (const track of tracks) {
    out.push({ track, resolution: await resolveTrack(db, track) });
  }
  return out;
};
