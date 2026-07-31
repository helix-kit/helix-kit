import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';
import type { DeviceEventQueue, RawDeviceEvent } from '../events';
import type { StorageProvider } from '../storage/interface';

import { device } from '../db/schema';
import { resolveDeviceAllowedKeys } from '../releases/resolve';
import { joinDeviceStorageKey } from '../storage/object-keys';
import { createRouterFactory } from '../trpc';

const devicePathInputSchema = z.object({
  path: z.string().min(1),
});

const MAX_EVENTS_PER_REQUEST = 500;
const MAX_EVENT_FIELD_LENGTH = 256;

const deviceEventInputSchema = z.object({
  msgId: z.string().trim().min(1).max(MAX_EVENT_FIELD_LENGTH).optional(),
  payload: z.unknown().optional(),
  timestamp: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).max(MAX_EVENT_FIELD_LENGTH),
});

const optionalDeviceIdSchema = z.string().min(1).optional();

const ingestEventsInputSchema = z.object({
  deviceId: optionalDeviceIdSchema,
  events: z.array(deviceEventInputSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
});

const ingestEventsOutputSchema = z.object({
  accepted: z.number().int().nonnegative(),
  deviceId: z.string(),
  results: z.array(z.object({ msgId: z.string(), status: z.literal('queued') })),
});

const deviceUploadInputSchema = devicePathInputSchema.extend({
  contentType: z.string().min(1).optional(),
});

const storageSignedRequestOutputSchema = z.object({
  bucket: z.string().optional(),
  expiresAt: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  method: z.enum(['GET', 'PUT']),
  objectKey: z.string().optional(),
  provider: z.enum(['AZURE', 'FS', 'MINIO', 'S3']),
  url: z.string(),
});

export type DeviceMtlsContext = Readonly<{
  deviceId: string;
  storageProvider: StorageProvider;
  eventQueue: DeviceEventQueue;
  db: DatabaseClient;
}>;

export const fileRouter = createRouterFactory<DeviceMtlsContext>()((t) =>
  t.router({
    createDeviceDownloadSession: t.procedure
      .meta({ openapi: { method: 'POST', path: '/api/storage/devices/download-session' } })
      .input(devicePathInputSchema)
      .output(storageSignedRequestOutputSchema)
      .mutation(({ ctx, input }) => {
        return ctx.storageProvider.getSignedUrlForDownload({
          key: joinDeviceStorageKey(ctx.deviceId, input.path),
        });
      }),
    createDeviceUploadSession: t.procedure
      .meta({ openapi: { method: 'POST', path: '/api/storage/devices/upload-session' } })
      .input(deviceUploadInputSchema)
      .output(storageSignedRequestOutputSchema)
      .mutation(({ ctx, input }) => {
        return ctx.storageProvider.getSignedUrlForUpload({
          contentType: input.contentType ?? 'application/octet-stream',
          key: joinDeviceStorageKey(ctx.deviceId, input.path),
        });
      }),
    createPackageDownloadSession: t.procedure
      .meta({ openapi: { method: 'POST', path: '/api/storage/packages/download-session' } })
      .input(devicePathInputSchema)
      .output(storageSignedRequestOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ isActive: device.isActive })
          .from(device)
          .where(eq(device.id, ctx.deviceId))
          .limit(1);
        if (row?.isActive !== true) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Device is not active.' });
        }
        const allowed = await resolveDeviceAllowedKeys(ctx.db, ctx.deviceId);
        if (!allowed.has(input.path)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Device is not authorized for this artifact.',
          });
        }
        return ctx.storageProvider.getSignedUrlForDownload({ key: input.path });
      }),
    ingestEvents: t.procedure
      .meta({ openapi: { method: 'POST', path: '/api/device/events' } })
      .input(ingestEventsInputSchema)
      .output(ingestEventsOutputSchema)
      .mutation(async ({ ctx, input }) => {
        if (input.deviceId !== undefined && input.deviceId !== ctx.deviceId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'deviceId does not match the client certificate.',
          });
        }
        const { deviceId } = ctx;
        const receivedAt = new Date().toISOString();

        const results: Array<{ msgId: string; status: 'queued' }> = [];
        const batch: RawDeviceEvent[] = input.events.map((event) => {
          const msgId = event.msgId ?? randomUUID();
          results.push({ msgId, status: 'queued' });
          const envelope = {
            msgId,
            payload: event.payload ?? {},
            timestamp: event.timestamp,
            type: event.type,
          };
          return { deviceId, payload: JSON.stringify(envelope), receivedAt };
        });

        await ctx.eventQueue.publishBatch(batch);

        return { accepted: results.length, deviceId, results };
      }),
  }),
);
