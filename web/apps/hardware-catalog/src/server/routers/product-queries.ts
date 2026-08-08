import { asc, eq, inArray } from 'drizzle-orm';

import type { CatalogDatabase } from '../db';

import {
  compatibilityClaim,
  compatibilityDelta,
  formFactor,
  type interfaceKindEnum,
  lifecycleEvent,
  longevityCommitment,
  manufacturer,
  operatingMode,
  priceEstimate,
  product,
  productAntenna,
  productCertification,
  productComposition,
  productConnector,
  productEnvironment,
  productExposedInterface,
  productFormFactor,
  productImage,
  productLink,
  productMemory,
  productPower,
  productPowerDraw,
  productRevision,
  productSilicon,
  productStorage,
  productVariant,
  silicon,
  siliconInterface,
  softwarePlatform,
  softwareSupportClaim,
  source,
} from '../schema';
import { publicAssetUrl } from '../storage';

/** Assembling a product: its own rows, the silicon it carries, and what that combination means. */

type InterfaceKind = (typeof interfaceKindEnum.enumValues)[number];

export type CapabilityGapRow = {
  kind: InterfaceKind;
  /** Total instances the attached silicon provides. */
  siliconProvides: number;
  /** Instances actually routed to a connector or header on this product. */
  productExposes: number;
  providedBy: string[];
};

/**
 * Finding 5 made concrete: an SoC may offer six USB controllers while the board routes two.
 * Comparing the silicon's capability rows against the product's exposure rows is the query
 * that a flat spec table cannot answer at all.
 */
const buildCapabilityGap = (
  siliconInterfaces: readonly { kind: InterfaceKind; count: number; siliconName: string }[],
  exposed: readonly { kind: InterfaceKind; count: number }[],
): CapabilityGapRow[] => {
  const provided = new Map<InterfaceKind, { count: number; providedBy: Set<string> }>();
  for (const row of siliconInterfaces) {
    const entry = provided.get(row.kind) ?? { count: 0, providedBy: new Set<string>() };
    entry.count += row.count;
    entry.providedBy.add(row.siliconName);
    provided.set(row.kind, entry);
  }

  const exposedCounts = new Map<InterfaceKind, number>();
  for (const row of exposed) {
    exposedCounts.set(row.kind, (exposedCounts.get(row.kind) ?? 0) + row.count);
  }

  const kinds = new Set<InterfaceKind>([...provided.keys(), ...exposedCounts.keys()]);
  return [...kinds]
    .map((kind) => ({
      kind,
      siliconProvides: provided.get(kind)?.count ?? 0,
      productExposes: exposedCounts.get(kind) ?? 0,
      providedBy: [...(provided.get(kind)?.providedBy ?? [])],
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
};

export const loadProductDetail = async (db: CatalogDatabase, productId: string) => {
  const [head] = await db
    .select({ product, manufacturer })
    .from(product)
    .leftJoin(manufacturer, eq(product.manufacturerId, manufacturer.id))
    .where(eq(product.id, productId))
    .limit(1);

  if (head == null) {
    return null;
  }

  const [
    variants,
    siliconRows,
    exposed,
    connectors,
    memory,
    storage,
    power,
    powerDraw,
    modes,
    antennas,
    certifications,
    formFactors,
    environment,
    revisions,
    composition,
    compatibility,
    lifecycle,
    longevity,
    support,
    links,
    images,
    prices,
  ] = await Promise.all([
    db
      .select()
      .from(productVariant)
      .where(eq(productVariant.productId, productId))
      .orderBy(asc(productVariant.name)),
    db
      .select({ link: productSilicon, silicon })
      .from(productSilicon)
      .innerJoin(silicon, eq(productSilicon.siliconId, silicon.id))
      .where(eq(productSilicon.productId, productId))
      .orderBy(asc(productSilicon.role)),
    db
      .select()
      .from(productExposedInterface)
      .where(eq(productExposedInterface.productId, productId))
      .orderBy(asc(productExposedInterface.kind)),
    db.select().from(productConnector).where(eq(productConnector.productId, productId)),
    db.select().from(productMemory).where(eq(productMemory.productId, productId)),
    db.select().from(productStorage).where(eq(productStorage.productId, productId)),
    db.select().from(productPower).where(eq(productPower.productId, productId)),
    db.select().from(productPowerDraw).where(eq(productPowerDraw.productId, productId)),
    db
      .select()
      .from(operatingMode)
      .where(eq(operatingMode.productId, productId))
      .orderBy(asc(operatingMode.name)),
    db.select().from(productAntenna).where(eq(productAntenna.productId, productId)),
    db.select().from(productCertification).where(eq(productCertification.productId, productId)),
    db
      .select({ link: productFormFactor, formFactor })
      .from(productFormFactor)
      .innerJoin(formFactor, eq(productFormFactor.formFactorId, formFactor.id))
      .where(eq(productFormFactor.productId, productId)),
    db.select().from(productEnvironment).where(eq(productEnvironment.productId, productId)),
    db
      .select()
      .from(productRevision)
      .where(eq(productRevision.productId, productId))
      .orderBy(asc(productRevision.sequence)),
    db
      .select({ link: productComposition, child: product })
      .from(productComposition)
      .innerJoin(product, eq(productComposition.childProductId, product.id))
      .where(eq(productComposition.parentProductId, productId)),
    db.select().from(compatibilityClaim).where(eq(compatibilityClaim.subjectProductId, productId)),
    db
      .select()
      .from(lifecycleEvent)
      .where(eq(lifecycleEvent.productId, productId))
      .orderBy(asc(lifecycleEvent.effectiveAt)),
    db.select().from(longevityCommitment).where(eq(longevityCommitment.productId, productId)),
    db
      .select({ claim: softwareSupportClaim, platform: softwarePlatform })
      .from(softwareSupportClaim)
      .innerJoin(softwarePlatform, eq(softwareSupportClaim.softwarePlatformId, softwarePlatform.id))
      .where(eq(softwareSupportClaim.productId, productId)),
    db
      .select()
      .from(productLink)
      .where(eq(productLink.productId, productId))
      .orderBy(asc(productLink.kind)),
    db
      .select()
      .from(productImage)
      .where(eq(productImage.productId, productId))
      .orderBy(asc(productImage.sortOrder)),
    // The page a price was read from is also where you buy it, so it comes back with the row.
    db
      .select({
        price: priceEstimate,
        variantName: productVariant.name,
        vendorUrl: source.url,
        vendorName: source.publisher,
      })
      .from(priceEstimate)
      .leftJoin(productVariant, eq(priceEstimate.variantId, productVariant.id))
      .leftJoin(source, eq(priceEstimate.sourceId, source.id))
      .where(eq(priceEstimate.productId, productId))
      .orderBy(asc(priceEstimate.countryCode)),
  ]);

  const claimIds = compatibility.map((row) => row.id);
  const deltas =
    claimIds.length === 0
      ? []
      : await db
          .select()
          .from(compatibilityDelta)
          .where(inArray(compatibilityDelta.claimId, claimIds));

  const siliconIds = siliconRows.map((row) => row.silicon.id);
  const siliconInterfaces =
    siliconIds.length === 0
      ? []
      : await db
          .select({ row: siliconInterface, siliconName: silicon.name })
          .from(siliconInterface)
          .innerJoin(silicon, eq(siliconInterface.siliconId, silicon.id))
          .where(inArray(siliconInterface.siliconId, siliconIds));

  return {
    ...head.product,
    manufacturer: head.manufacturer,
    variants,
    silicon: siliconRows.map((row) => ({ ...row.link, silicon: row.silicon })),
    exposedInterfaces: exposed,
    connectors,
    memory,
    storage,
    power,
    powerDraw,
    operatingModes: modes,
    antennas,
    certifications,
    formFactors: formFactors.map((row) => ({ ...row.link, formFactor: row.formFactor })),
    environment,
    revisions,
    composition: composition.map((row) => ({ ...row.link, child: row.child })),
    compatibility: compatibility.map((row) => ({
      ...row,
      deltas: deltas.filter((delta) => delta.claimId === row.id),
    })),
    lifecycle,
    longevity,
    links,
    prices: prices.map((row) => ({
      ...row.price,
      variantName: row.variantName,
      vendorUrl: row.vendorUrl,
      vendorName: row.vendorName,
    })),
    images: images.map((image) => ({
      ...image,
      displayUrl: image.storageKey == null ? image.url : publicAssetUrl(image.storageKey),
    })),
    softwareSupport: support.map((row) => ({ ...row.claim, platform: row.platform })),
    capabilityGap: buildCapabilityGap(
      siliconInterfaces.map((row) => ({
        kind: row.row.kind,
        count: row.row.count,
        siliconName: row.siliconName,
      })),
      exposed.map((row) => ({ kind: row.kind, count: row.count })),
    ),
  };
};
