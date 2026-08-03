import { and, asc, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { createEntityRouter } from './crud';
import { loadProductDetail } from './product-queries';

import { catalogRouter } from '../context';
import {
  interfaceKindEnum,
  manufacturer,
  product,
  productExposedInterface,
  productFormFactor,
  productImage,
  productSilicon,
  productTierEnum,
  silicon,
  siliconRoleEnum,
} from '../schema';
import { publicAssetUrl } from '../storage';

/** Browsing products, and walking from a chip to every board built on it. */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const filterInput = z.object({
  search: z.string().trim().default(''),
  tiers: z.array(z.enum(productTierEnum.enumValues)).default([]),
  manufacturerIds: z.array(z.string()).default([]),
  siliconIds: z.array(z.string()).default([]),
  siliconRoles: z.array(z.enum(siliconRoleEnum.enumValues)).default([]),
  formFactorIds: z.array(z.string()).default([]),
  /** Every listed interface must be exposed on the product, not merely present on its silicon. */
  exposedInterfaceKinds: z.array(z.enum(interfaceKindEnum.enumValues)).default([]),
});

type ProductFilter = z.infer<typeof filterInput>;

const buildProductFilters = (input: ProductFilter, db: unknown): SQL[] => {
  const database = db as Parameters<typeof loadProductDetail>[0];
  const filters: SQL[] = [];

  if (input.search !== '') {
    const pattern = `%${input.search}%`;
    const match = or(
      ilike(product.name, pattern),
      ilike(product.slug, pattern),
      ilike(product.familyName, pattern),
      ilike(product.summary, pattern),
    );
    if (match != null) {
      filters.push(match);
    }
  }

  if (input.tiers.length > 0) {
    filters.push(inArray(product.tier, input.tiers));
  }

  if (input.manufacturerIds.length > 0) {
    filters.push(inArray(product.manufacturerId, input.manufacturerIds));
  }

  if (input.siliconIds.length > 0 || input.siliconRoles.length > 0) {
    const clauses: SQL[] = [];
    if (input.siliconIds.length > 0) {
      clauses.push(inArray(productSilicon.siliconId, input.siliconIds));
    }
    if (input.siliconRoles.length > 0) {
      clauses.push(inArray(productSilicon.role, input.siliconRoles));
    }
    filters.push(
      inArray(
        product.id,
        database
          .select({ id: productSilicon.productId })
          .from(productSilicon)
          .where(and(...clauses)),
      ),
    );
  }

  if (input.formFactorIds.length > 0) {
    filters.push(
      inArray(
        product.id,
        database
          .select({ id: productFormFactor.productId })
          .from(productFormFactor)
          .where(inArray(productFormFactor.formFactorId, input.formFactorIds)),
      ),
    );
  }

  for (const kind of input.exposedInterfaceKinds) {
    filters.push(
      inArray(
        product.id,
        database
          .select({ id: productExposedInterface.productId })
          .from(productExposedInterface)
          .where(eq(productExposedInterface.kind, kind)),
      ),
    );
  }

  return filters;
};

export const productsRouter = catalogRouter((t) =>
  t.router({
    list: t.procedure
      .input(
        filterInput.extend({
          limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters = buildProductFilters(input, ctx.db);
        const where = filters.length === 0 ? undefined : and(...filters);

        const [items, totals] = await Promise.all([
          ctx.db
            .select({
              product,
              manufacturer,
              thumbnailKey: productImage.storageKey,
              thumbnailAlt: productImage.alt,
            })
            .from(product)
            .leftJoin(manufacturer, eq(product.manufacturerId, manufacturer.id))
            // Only the primary image, so a product with a gallery still yields one row.
            .leftJoin(
              productImage,
              and(eq(productImage.productId, product.id), eq(productImage.isPrimary, true)),
            )
            .where(where)
            .orderBy(asc(product.name))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db.select({ value: count() }).from(product).where(where),
        ]);

        return {
          items: items.map((row) => ({
            ...row.product,
            manufacturer: row.manufacturer,
            thumbnail: row.thumbnailKey == null ? null : publicAssetUrl(row.thumbnailKey),
            thumbnailAlt: row.thumbnailAlt,
          })),
          total: totals[0]?.value ?? 0,
        };
      }),

    detail: t.procedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: product.id })
        .from(product)
        .where(eq(product.slug, input.slug))
        .limit(1);
      return row == null ? null : loadProductDetail(ctx.db, row.id);
    }),

    /**
     * "Compare this SoC across the boards that use it." Returns every product carrying the
     * silicon together with the role it plays, since the same chip is an application processor
     * on one board and a radio co-processor on another.
     */
    bySilicon: t.procedure
      .input(z.object({ siliconSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ id: silicon.id })
          .from(silicon)
          .where(eq(silicon.slug, input.siliconSlug))
          .limit(1);
        if (row == null) {
          return [];
        }

        const links = await ctx.db
          .select({ link: productSilicon, product, manufacturer })
          .from(productSilicon)
          .innerJoin(product, eq(productSilicon.productId, product.id))
          .leftJoin(manufacturer, eq(product.manufacturerId, manufacturer.id))
          .where(eq(productSilicon.siliconId, row.id))
          .orderBy(asc(product.name));

        return links.map((entry) => ({
          ...entry.product,
          manufacturer: entry.manufacturer,
          role: entry.link.role,
          interconnect: entry.link.interconnect,
        }));
      }),
  }),
);

export const productEntityRouter = createEntityRouter({
  table: product,
  idPrefix: 'prd',
  searchColumns: [product.name, product.slug, product.familyName],
  orderBy: product.name,
  parentColumn: product.manufacturerId,
  slugColumn: product.slug,
});
