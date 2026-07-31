import { resolveDeviceTracks } from '@helix/backend/releases';
import { createRouterFactory } from '@helix/backend/trpc';
import { z } from 'zod';

import type { DatabaseClient } from '@helix/backend/db';
import type { StorageProvider } from '@helix/backend/storage/interface';

export type EspFlasherContext = Readonly<{
  db: DatabaseClient;
  storage: StorageProvider;
}>;

const ESP32_TYPE_KEY = 'esp32-firmware';
const HEX = 16;

export const espFlasherRouter = createRouterFactory<EspFlasherContext>()((t) =>
  t.router({
    getFirmwares: t.procedure
      .input(z.object({ deviceId: z.string() }))
      .query(async ({ ctx, input }) => {
        const tracks = await resolveDeviceTracks(ctx.db, input.deviceId);
        const firmwares: Array<{
          variantId: string;
          featureSet: string | null;
          version: string;
          label: string;
          manifest: {
            chip: 'esp32';
            baudRate: number;
            flashMode: 'dio';
            flashFreq: '40m';
            flashSize: string;
            profile: string;
            artifacts: Array<{
              id: string;
              name: string;
              offset: number;
              sha256: string;
              size: number;
              url: string;
            }>;
          };
        }> = [];

        for (const { track, resolution } of tracks) {
          if (track.typeKey !== ESP32_TYPE_KEY) {
            continue;
          }
          if (
            resolution.status !== 'resolved' ||
            resolution.variant === null ||
            resolution.release === null
          ) {
            continue;
          }
          const selector = (resolution.variant.selector ?? {}) as {
            flashSize?: string;
            featureSet?: string;
          };

          const artifacts = [];
          for (const artifact of resolution.artifacts) {
            if (
              artifact.storageMode !== 'blob' ||
              artifact.storageKey === null ||
              artifact.sha256 === null ||
              artifact.offset === null ||
              artifact.sizeBytes === null
            ) {
              continue;
            }
            const signed = await ctx.storage.getSignedUrlForDownload({ key: artifact.storageKey });
            artifacts.push({
              id: artifact.role,
              name: `${artifact.role}.bin`,
              offset: Number.parseInt(artifact.offset, HEX),
              sha256: artifact.sha256,
              size: artifact.sizeBytes,
              url: signed.url,
            });
          }
          if (artifacts.length === 0) {
            continue;
          }

          firmwares.push({
            variantId: resolution.variant.id,
            featureSet: selector.featureSet ?? null,
            version: resolution.release.version,
            label: `${resolution.release.name} ${resolution.release.version}${
              selector.featureSet === undefined ? '' : ` · ${selector.featureSet}`
            }`,
            manifest: {
              chip: 'esp32',
              baudRate: 460800,
              flashMode: 'dio',
              flashFreq: '40m',
              flashSize: selector.flashSize ?? '4MB',
              profile: selector.featureSet ?? 'default',
              artifacts,
            },
          });
        }

        return firmwares;
      }),
  }),
);

export type EspFlasherRouter = ReturnType<typeof espFlasherRouter>;
