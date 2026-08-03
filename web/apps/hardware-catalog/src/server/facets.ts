import 'server-only';

import { count, countDistinct } from 'drizzle-orm';

import { db } from './db';
import { silicon, siliconComputeUnit, siliconInterface, siliconRadio } from './schema';

/**
 * How many parts each filter would actually match.
 *
 * Without this the filter rail lies by omission: `silicon_interface` is populated for a handful
 * of parts (board documentation describes what a board exposes, not what a die provides — see
 * the capability/exposure split), so clicking "PCIe" returns one result and reads as a broken
 * filter rather than as missing data. Showing the count makes the gap legible before the click.
 *
 * Counts are over the whole catalog, not conditioned on the other active filters — enough to
 * answer "is there anything here at all", which is the question that was being missed.
 */

export type FacetCounts = {
  kinds: Record<string, number>;
  coreKinds: Record<string, number>;
  interfaceKinds: Record<string, number>;
  radioStandards: Record<string, number>;
  manufacturers: Record<string, number>;
  coreDesigns: Record<string, number>;
};

const toRecord = (rows: readonly { key: string | null; value: number }[]): Record<string, number> =>
  Object.fromEntries(rows.flatMap((row) => (row.key == null ? [] : [[row.key, row.value]])));

export const siliconFacetCounts = async (): Promise<FacetCounts> => {
  const [kinds, coreKinds, interfaceKinds, radioStandards, manufacturers, coreDesigns] =
    await Promise.all([
      db.select({ key: silicon.kind, value: count() }).from(silicon).groupBy(silicon.kind),
      db
        .select({
          key: siliconComputeUnit.kind,
          value: countDistinct(siliconComputeUnit.siliconId),
        })
        .from(siliconComputeUnit)
        .groupBy(siliconComputeUnit.kind),
      db
        .select({ key: siliconInterface.kind, value: countDistinct(siliconInterface.siliconId) })
        .from(siliconInterface)
        .groupBy(siliconInterface.kind),
      db
        .select({ key: siliconRadio.standard, value: countDistinct(siliconRadio.siliconId) })
        .from(siliconRadio)
        .groupBy(siliconRadio.standard),
      db
        .select({ key: silicon.manufacturerId, value: count() })
        .from(silicon)
        .groupBy(silicon.manufacturerId),
      db
        .select({
          key: siliconComputeUnit.coreDesignId,
          value: countDistinct(siliconComputeUnit.siliconId),
        })
        .from(siliconComputeUnit)
        .groupBy(siliconComputeUnit.coreDesignId),
    ]);

  return {
    kinds: toRecord(kinds),
    coreKinds: toRecord(coreKinds),
    interfaceKinds: toRecord(interfaceKinds),
    radioStandards: toRecord(radioStandards),
    manufacturers: toRecord(manufacturers),
    coreDesigns: toRecord(coreDesigns),
  };
};
