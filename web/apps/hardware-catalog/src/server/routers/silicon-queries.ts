import { asc, eq, inArray } from 'drizzle-orm';

import type { CatalogDatabase } from '../db';

import {
  architecture,
  coreDesign,
  manufacturer,
  silicon,
  siliconAcceleratorPerformance,
  siliconAcceleratorPrecision,
  siliconComputeUnit,
  siliconInterface,
  siliconIsp,
  siliconMediaCodec,
  siliconMemorySupport,
  siliconRadio,
  siliconSecurityFeature,
  siliconVariant,
} from '../schema';

/**
 * Loading the full silicon graph. Written as a batch load over a set of ids rather than a
 * per-row fetch because comparison is the primary use case: comparing six SoCs must not mean
 * sixty round trips.
 */

const groupBy = <TRow>(rows: readonly TRow[], key: (row: TRow) => string | null) => {
  const grouped = new Map<string, TRow[]>();
  for (const row of rows) {
    const id = key(row);
    if (id == null) {
      continue;
    }
    const bucket = grouped.get(id);
    if (bucket == null) {
      grouped.set(id, [row]);
    } else {
      bucket.push(row);
    }
  }
  return grouped;
};

export const loadSiliconGraph = async (db: CatalogDatabase, siliconIds: readonly string[]) => {
  if (siliconIds.length === 0) {
    return [];
  }
  const ids = [...siliconIds];

  const [heads, variants, computeUnits, memory, interfaces, codecs, isps, radios, security] =
    await Promise.all([
      db
        .select({ silicon, manufacturer })
        .from(silicon)
        .leftJoin(manufacturer, eq(silicon.manufacturerId, manufacturer.id))
        .where(inArray(silicon.id, ids)),
      db
        .select()
        .from(siliconVariant)
        .where(inArray(siliconVariant.siliconId, ids))
        .orderBy(asc(siliconVariant.orderingCode)),
      db
        .select({ unit: siliconComputeUnit, coreDesign, architecture })
        .from(siliconComputeUnit)
        .leftJoin(coreDesign, eq(siliconComputeUnit.coreDesignId, coreDesign.id))
        .leftJoin(architecture, eq(coreDesign.architectureId, architecture.id))
        .where(inArray(siliconComputeUnit.siliconId, ids))
        .orderBy(asc(siliconComputeUnit.kind), asc(siliconComputeUnit.label)),
      db.select().from(siliconMemorySupport).where(inArray(siliconMemorySupport.siliconId, ids)),
      db
        .select()
        .from(siliconInterface)
        .where(inArray(siliconInterface.siliconId, ids))
        .orderBy(asc(siliconInterface.kind)),
      db
        .select()
        .from(siliconMediaCodec)
        .where(inArray(siliconMediaCodec.siliconId, ids))
        .orderBy(asc(siliconMediaCodec.format)),
      db.select().from(siliconIsp).where(inArray(siliconIsp.siliconId, ids)),
      db.select().from(siliconRadio).where(inArray(siliconRadio.siliconId, ids)),
      db
        .select()
        .from(siliconSecurityFeature)
        .where(inArray(siliconSecurityFeature.siliconId, ids)),
    ]);

  const unitIds = computeUnits.map((row) => row.unit.id);
  const [performance, precisions] = await Promise.all([
    unitIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(siliconAcceleratorPerformance)
          .where(inArray(siliconAcceleratorPerformance.computeUnitId, unitIds)),
    unitIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(siliconAcceleratorPrecision)
          .where(inArray(siliconAcceleratorPrecision.computeUnitId, unitIds)),
  ]);

  const performanceByUnit = groupBy(performance, (row) => row.computeUnitId);
  const precisionsByUnit = groupBy(precisions, (row) => row.computeUnitId);
  const variantsBySilicon = groupBy(variants, (row) => row.siliconId);
  const unitsBySilicon = groupBy(computeUnits, (row) => row.unit.siliconId);
  const memoryBySilicon = groupBy(memory, (row) => row.siliconId);
  const interfacesBySilicon = groupBy(interfaces, (row) => row.siliconId);
  const codecsBySilicon = groupBy(codecs, (row) => row.siliconId);
  const ispsBySilicon = groupBy(isps, (row) => row.siliconId);
  const radiosBySilicon = groupBy(radios, (row) => row.siliconId);
  const securityBySilicon = groupBy(security, (row) => row.siliconId);

  // Preserve the caller's ordering: comparison columns must line up with what was requested.
  const byId = new Map(heads.map((row) => [row.silicon.id, row]));

  return ids.flatMap((id) => {
    const head = byId.get(id);
    if (head == null) {
      return [];
    }
    return [
      {
        ...head.silicon,
        manufacturer: head.manufacturer,
        variants: variantsBySilicon.get(id) ?? [],
        computeUnits: (unitsBySilicon.get(id) ?? []).map((row) => ({
          ...row.unit,
          coreDesign: row.coreDesign,
          architecture: row.architecture,
          performance: performanceByUnit.get(row.unit.id) ?? [],
          precisions: (precisionsByUnit.get(row.unit.id) ?? []).map((entry) => entry.precision),
        })),
        memory: memoryBySilicon.get(id) ?? [],
        interfaces: interfacesBySilicon.get(id) ?? [],
        codecs: codecsBySilicon.get(id) ?? [],
        isp: ispsBySilicon.get(id) ?? [],
        radios: radiosBySilicon.get(id) ?? [],
        security: securityBySilicon.get(id) ?? [],
      },
    ];
  });
};

export type SiliconGraph = Awaited<ReturnType<typeof loadSiliconGraph>>[number];

/**
 * The subset a list view needs: the head row plus its compute units, which is what makes a
 * listing readable ("2× A76 + 6× A55 + 3 TOPS NPU") without shipping the whole graph.
 */
export const loadSiliconSummaries = async (db: CatalogDatabase, siliconIds: readonly string[]) => {
  if (siliconIds.length === 0) {
    return [];
  }
  const ids = [...siliconIds];

  const [heads, computeUnits] = await Promise.all([
    db
      .select({ silicon, manufacturer })
      .from(silicon)
      .leftJoin(manufacturer, eq(silicon.manufacturerId, manufacturer.id))
      .where(inArray(silicon.id, ids)),
    db
      .select({ unit: siliconComputeUnit, coreDesign })
      .from(siliconComputeUnit)
      .leftJoin(coreDesign, eq(siliconComputeUnit.coreDesignId, coreDesign.id))
      .where(inArray(siliconComputeUnit.siliconId, ids))
      .orderBy(asc(siliconComputeUnit.kind)),
  ]);

  const unitIds = computeUnits.map((row) => row.unit.id);
  const performance =
    unitIds.length === 0
      ? []
      : await db
          .select()
          .from(siliconAcceleratorPerformance)
          .where(inArray(siliconAcceleratorPerformance.computeUnitId, unitIds));

  const performanceByUnit = groupBy(performance, (row) => row.computeUnitId);
  const unitsBySilicon = groupBy(computeUnits, (row) => row.unit.siliconId);
  const byId = new Map(heads.map((row) => [row.silicon.id, row]));

  return ids.flatMap((id) => {
    const head = byId.get(id);
    if (head == null) {
      return [];
    }
    return [
      {
        ...head.silicon,
        manufacturer: head.manufacturer,
        computeUnits: (unitsBySilicon.get(id) ?? []).map((row) => ({
          ...row.unit,
          coreDesign: row.coreDesign,
          performance: performanceByUnit.get(row.unit.id) ?? [],
        })),
      },
    ];
  });
};
