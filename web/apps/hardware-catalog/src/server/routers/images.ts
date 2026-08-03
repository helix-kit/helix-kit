import { TRPCError } from '@helix/backend/trpc';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { catalogRouter } from '../context';
import { productImage } from '../schema';
import { CATALOG_IMAGE_PREFIX, publicAssetUrl, storage } from '../storage';

/**
 * Mirroring product images into the shared Helix bucket. Vendors reorganise their sites and
 * some block hotlinking, so the catalog serves its own copy while `url` keeps recording where
 * the image came from.
 */

const MAX_BYTES = 8_388_608; // 8 MiB
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BATCH = 200;
const DEFAULT_BATCH = 50;

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/** Some vendor CDNs reject a default fetch agent outright. */
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; helix-hardware-catalog/0.1)',
  accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
};

type Mirrored = { id: string; storageKey: string; contentType: string; byteSize: number };

const mirrorOne = async (image: { id: string; url: string }): Promise<Mirrored> => {
  const response = await fetch(image.url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`not an image (content-type: ${contentType === '' ? 'none' : contentType})`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_BYTES) {
    throw new Error(`image exceeds ${MAX_BYTES} bytes`);
  }

  const storageKey = `${CATALOG_IMAGE_PREFIX}/${image.id}.${EXTENSIONS[contentType] ?? 'bin'}`;
  await storage.upload({ key: storageKey, data: body, contentType });

  return { id: image.id, storageKey, contentType, byteSize: body.byteLength };
};

export const imagesRouter = catalogRouter((t) =>
  t.router({
    /** Fetch every unmirrored image (or one by id) and upload it to the shared bucket. */
    mirror: t.procedure
      .input(
        z.object({
          id: z.string().optional(),
          limit: z.number().int().min(1).max(MAX_BATCH).default(DEFAULT_BATCH),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const pending = await ctx.db
          .select({ id: productImage.id, url: productImage.url })
          .from(productImage)
          .where(input.id == null ? isNull(productImage.storageKey) : eq(productImage.id, input.id))
          .limit(input.limit);

        const mirrored: Mirrored[] = [];
        const failed: { url: string; reason: string }[] = [];

        for (const image of pending) {
          try {
            const result = await mirrorOne(image);
            await ctx.db
              .update(productImage)
              .set({
                storageKey: result.storageKey,
                contentType: result.contentType,
                byteSize: result.byteSize,
              })
              .where(eq(productImage.id, result.id));
            mirrored.push(result);
          } catch (error) {
            failed.push({
              url: image.url,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          attempted: pending.length,
          mirrored: mirrored.map((entry) => ({
            ...entry,
            publicUrl: publicAssetUrl(entry.storageKey),
          })),
          failed,
        };
      }),

    /** Where an image is served from, or null if it has not been mirrored yet. */
    publicUrl: t.procedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ storageKey: productImage.storageKey })
        .from(productImage)
        .where(eq(productImage.id, input.id))
        .limit(1);
      if (row == null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Image not found' });
      }
      return row.storageKey == null ? null : publicAssetUrl(row.storageKey);
    }),
  }),
);
