import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { createEntityRouter } from './crud';
import { loadSiliconGraph, loadSiliconSummaries } from './silicon-queries';

import { catalogRouter } from '../context';
import {
  coreDesign,
  coreKindEnum,
  interfaceKindEnum,
  precisionEnum,
  product,
  productSilicon,
  radioStandardEnum,
  securityFeatureKindEnum,
  silicon,
  siliconAcceleratorPerformance,
  siliconComputeUnit,
  siliconInterface,
  siliconKindEnum,
  siliconRadio,
  siliconSecurityFeature,
} from '../schema';

/**
 * Reading the silicon graph: filtering by what a chip *is made of* (core designs, engine kinds,
 * peripherals, radios, accelerator throughput), comparing several side by side, and walking
 * from a chip to every board that carries it.
 */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_COMPARE = 8;

const filterInput = z.object({
  search: z.string().trim().default(''),
  kinds: z.array(z.enum(siliconKindEnum.enumValues)).default([]),
  manufacturerIds: z.array(z.string()).default([]),
  /** Match silicon carrying a specific core design — "every SoC with a Cortex-A76 cluster". */
  coreDesignIds: z.array(z.string()).default([]),
  /** Match by ISA: every RISC-V part, every Armv8-A part. */
  architectureIds: z.array(z.string()).default([]),
  /** Match by engine kind: has an NPU, has a GPU, has a DSP. */
  coreKinds: z.array(z.enum(coreKindEnum.enumValues)).default([]),
  /** Every listed peripheral must be present (AND), because requirements compose. */
  interfaceKinds: z.array(z.enum(interfaceKindEnum.enumValues)).default([]),
  radioStandards: z.array(z.enum(radioStandardEnum.enumValues)).default([]),
  securityFeatures: z.array(z.enum(securityFeatureKindEnum.enumValues)).default([]),
  /** Accelerator throughput floor. Meaningless without a precision, so both travel together. */
  minAcceleratorTops: z.number().optional(),
  acceleratorPrecision: z.enum(precisionEnum.enumValues).default('int8'),
});

type SiliconFilter = z.infer<typeof filterInput>;

/** Each clause is an id-set membership test, so filters compose without fanning out joins. */
const buildSiliconFilters = (input: SiliconFilter, db: unknown): SQL[] => {
  const database = db as Parameters<typeof loadSiliconGraph>[0];
  const filters: SQL[] = [];

  if (input.search !== '') {
    const pattern = `%${input.search}%`;
    const match = or(
      ilike(silicon.name, pattern),
      ilike(silicon.slug, pattern),
      ilike(silicon.partFamily, pattern),
      ilike(silicon.summary, pattern),
    );
    if (match != null) {
      filters.push(match);
    }
  }

  if (input.kinds.length > 0) {
    filters.push(inArray(silicon.kind, input.kinds));
  }

  if (input.manufacturerIds.length > 0) {
    filters.push(inArray(silicon.manufacturerId, input.manufacturerIds));
  }

  if (input.coreDesignIds.length > 0) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconComputeUnit.siliconId })
          .from(siliconComputeUnit)
          .where(inArray(siliconComputeUnit.coreDesignId, input.coreDesignIds)),
      ),
    );
  }

  if (input.architectureIds.length > 0) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconComputeUnit.siliconId })
          .from(siliconComputeUnit)
          .innerJoin(coreDesign, eq(siliconComputeUnit.coreDesignId, coreDesign.id))
          .where(inArray(coreDesign.architectureId, input.architectureIds)),
      ),
    );
  }

  for (const kind of input.coreKinds) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconComputeUnit.siliconId })
          .from(siliconComputeUnit)
          .where(eq(siliconComputeUnit.kind, kind)),
      ),
    );
  }

  for (const kind of input.interfaceKinds) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconInterface.siliconId })
          .from(siliconInterface)
          .where(eq(siliconInterface.kind, kind)),
      ),
    );
  }

  for (const standard of input.radioStandards) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconRadio.siliconId })
          .from(siliconRadio)
          .where(eq(siliconRadio.standard, standard)),
      ),
    );
  }

  for (const feature of input.securityFeatures) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconSecurityFeature.siliconId })
          .from(siliconSecurityFeature)
          .where(eq(siliconSecurityFeature.kind, feature)),
      ),
    );
  }

  if (input.minAcceleratorTops != null) {
    filters.push(
      inArray(
        silicon.id,
        database
          .select({ id: siliconComputeUnit.siliconId })
          .from(siliconComputeUnit)
          .innerJoin(
            siliconAcceleratorPerformance,
            eq(siliconAcceleratorPerformance.computeUnitId, siliconComputeUnit.id),
          )
          .where(
            and(
              eq(siliconAcceleratorPerformance.precision, input.acceleratorPrecision),
              eq(siliconAcceleratorPerformance.unit, 'tops'),
              sql`${siliconAcceleratorPerformance.value}::numeric >= ${input.minAcceleratorTops}`,
            ),
          ),
      ),
    );
  }

  return filters;
};

export const siliconRouter = catalogRouter((t) =>
  t.router({
    /** Browse and filter. The filters are the "find by core type / feature" surface. */
    list: t.procedure
      .input(
        filterInput.extend({
          limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters = buildSiliconFilters(input, ctx.db);
        const where = filters.length === 0 ? undefined : and(...filters);

        const [rows, totals] = await Promise.all([
          ctx.db
            .select({ id: silicon.id })
            .from(silicon)
            .where(where)
            .orderBy(asc(silicon.name))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db.select({ value: count() }).from(silicon).where(where),
        ]);

        return {
          items: await loadSiliconSummaries(
            ctx.db,
            rows.map((row) => row.id),
          ),
          total: totals[0]?.value ?? 0,
        };
      }),

    /** The full graph for one part, by slug. */
    detail: t.procedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: silicon.id })
        .from(silicon)
        .where(eq(silicon.slug, input.slug))
        .limit(1);
      if (row == null) {
        return null;
      }
      const [graph] = await loadSiliconGraph(ctx.db, [row.id]);
      return graph ?? null;
    }),

    /** Side-by-side comparison. Returned in the order requested so columns line up. */
    compare: t.procedure
      .input(z.object({ slugs: z.array(z.string()).min(1).max(MAX_COMPARE) }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({ id: silicon.id, slug: silicon.slug })
          .from(silicon)
          .where(inArray(silicon.slug, input.slugs));

        const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));
        const ordered = input.slugs.flatMap((slug) => {
          const id = idBySlug.get(slug);
          return id == null ? [] : [id];
        });
        return loadSiliconGraph(ctx.db, ordered);
      }),

    /**
     * Every product carrying this silicon, in any role. Finding 4 is why the role comes back
     * with it: the same chip can be a board's application processor or its radio co-processor.
     */
    products: t.procedure
      .input(z.object({ siliconId: z.string() }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .select({ product, role: productSilicon.role, interconnect: productSilicon.interconnect })
          .from(productSilicon)
          .innerJoin(product, eq(productSilicon.productId, product.id))
          .where(eq(productSilicon.siliconId, input.siliconId))
          .orderBy(asc(product.name)),
      ),
  }),
);

export const siliconEntityRouter = createEntityRouter({
  table: silicon,
  idPrefix: 'sil',
  searchColumns: [silicon.name, silicon.slug, silicon.partFamily],
  orderBy: silicon.name,
  parentColumn: silicon.manufacturerId,
  slugColumn: silicon.slug,
});
