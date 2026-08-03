import { createEntityRouter } from './crud';

import {
  changeProposal,
  claim,
  compatibilityClaim,
  compatibilityDelta,
  lifecycleEvent,
  longevityCommitment,
  operatingMode,
  priceEstimate,
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
  researchTask,
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
  softwareSupportClaim,
  source,
} from '../schema';

/**
 * Write surface for every child table. Each is the same generic CRUD specialised by its parent
 * column, so an agent filling in a chip's peripherals uses exactly the shape it uses for its
 * codecs. Read paths that need the assembled graph live in the entity-specific routers.
 */

// ── Silicon children ────────────────────────────────────────────────────────────────────

export const siliconVariantsRouter = createEntityRouter({
  table: siliconVariant,
  idPrefix: 'silv',
  searchColumns: [siliconVariant.orderingCode, siliconVariant.name],
  orderBy: siliconVariant.orderingCode,
  parentColumn: siliconVariant.siliconId,
});

export const siliconComputeUnitsRouter = createEntityRouter({
  table: siliconComputeUnit,
  idPrefix: 'cu',
  searchColumns: [siliconComputeUnit.label],
  orderBy: siliconComputeUnit.label,
  parentColumn: siliconComputeUnit.siliconId,
});

export const siliconMemorySupportRouter = createEntityRouter({
  table: siliconMemorySupport,
  idPrefix: 'smem',
  searchColumns: [siliconMemorySupport.standard],
  orderBy: siliconMemorySupport.standard,
  parentColumn: siliconMemorySupport.siliconId,
});

export const siliconInterfacesRouter = createEntityRouter({
  table: siliconInterface,
  idPrefix: 'sif',
  searchColumns: [siliconInterface.version],
  orderBy: siliconInterface.kind,
  parentColumn: siliconInterface.siliconId,
});

export const siliconMediaCodecsRouter = createEntityRouter({
  table: siliconMediaCodec,
  idPrefix: 'scod',
  searchColumns: [siliconMediaCodec.profile],
  orderBy: siliconMediaCodec.format,
  parentColumn: siliconMediaCodec.siliconId,
});

export const siliconIspsRouter = createEntityRouter({
  table: siliconIsp,
  idPrefix: 'sisp',
  searchColumns: [siliconIsp.generation],
  orderBy: siliconIsp.generation,
  parentColumn: siliconIsp.siliconId,
});

export const siliconRadiosRouter = createEntityRouter({
  table: siliconRadio,
  idPrefix: 'srad',
  searchColumns: [siliconRadio.generation, siliconRadio.specName],
  orderBy: siliconRadio.standard,
  parentColumn: siliconRadio.siliconId,
});

export const siliconSecurityFeaturesRouter = createEntityRouter({
  table: siliconSecurityFeature,
  idPrefix: 'ssec',
  searchColumns: [siliconSecurityFeature.detail],
  orderBy: siliconSecurityFeature.kind,
  parentColumn: siliconSecurityFeature.siliconId,
});

export const acceleratorPerformanceRouter = createEntityRouter({
  table: siliconAcceleratorPerformance,
  idPrefix: 'perf',
  searchColumns: [siliconAcceleratorPerformance.conditions],
  orderBy: siliconAcceleratorPerformance.precision,
  parentColumn: siliconAcceleratorPerformance.computeUnitId,
});

export const acceleratorPrecisionsRouter = createEntityRouter({
  table: siliconAcceleratorPrecision,
  idPrefix: 'prec',
  orderBy: siliconAcceleratorPrecision.precision,
  parentColumn: siliconAcceleratorPrecision.computeUnitId,
});

// ── Product children ────────────────────────────────────────────────────────────────────

export const productVariantsRouter = createEntityRouter({
  table: productVariant,
  idPrefix: 'pvar',
  searchColumns: [productVariant.name, productVariant.sku],
  orderBy: productVariant.name,
  parentColumn: productVariant.productId,
});

export const productCompositionsRouter = createEntityRouter({
  table: productComposition,
  idPrefix: 'pcomp',
  orderBy: productComposition.relation,
  parentColumn: productComposition.parentProductId,
});

export const productSiliconRouter = createEntityRouter({
  table: productSilicon,
  idPrefix: 'psil',
  searchColumns: [productSilicon.interconnect],
  orderBy: productSilicon.role,
  parentColumn: productSilicon.productId,
});

export const productMemoryRouter = createEntityRouter({
  table: productMemory,
  idPrefix: 'pmem',
  searchColumns: [productMemory.standard],
  orderBy: productMemory.kind,
  parentColumn: productMemory.productId,
});

export const productStorageRouter = createEntityRouter({
  table: productStorage,
  idPrefix: 'psto',
  searchColumns: [productStorage.interfaceSpec],
  orderBy: productStorage.kind,
  parentColumn: productStorage.productId,
});

export const productExposedInterfacesRouter = createEntityRouter({
  table: productExposedInterface,
  idPrefix: 'pif',
  searchColumns: [productExposedInterface.version, productExposedInterface.connectorDescription],
  orderBy: productExposedInterface.kind,
  parentColumn: productExposedInterface.productId,
});

export const priceEstimatesRouter = createEntityRouter({
  table: priceEstimate,
  idPrefix: 'price',
  searchColumns: [priceEstimate.countryCode, priceEstimate.currencyCode],
  orderBy: priceEstimate.countryCode,
  parentColumn: priceEstimate.productId,
});

export const productLinksRouter = createEntityRouter({
  table: productLink,
  idPrefix: 'plink',
  searchColumns: [productLink.url, productLink.label],
  orderBy: productLink.kind,
  parentColumn: productLink.productId,
});

export const productImagesRouter = createEntityRouter({
  table: productImage,
  idPrefix: 'pimg',
  searchColumns: [productImage.url, productImage.alt],
  orderBy: productImage.sortOrder,
  parentColumn: productImage.productId,
});

export const productConnectorsRouter = createEntityRouter({
  table: productConnector,
  idPrefix: 'pcon',
  searchColumns: [productConnector.name],
  orderBy: productConnector.name,
  parentColumn: productConnector.productId,
});

export const operatingModesRouter = createEntityRouter({
  table: operatingMode,
  idPrefix: 'mode',
  searchColumns: [operatingMode.name],
  orderBy: operatingMode.name,
  parentColumn: operatingMode.productId,
});

export const productPowerRouter = createEntityRouter({
  table: productPower,
  idPrefix: 'ppwr',
  searchColumns: [productPower.pdProfile],
  orderBy: productPower.inputKind,
  parentColumn: productPower.productId,
});

export const productPowerDrawRouter = createEntityRouter({
  table: productPowerDraw,
  idPrefix: 'pdraw',
  searchColumns: [productPowerDraw.scenario],
  orderBy: productPowerDraw.scenario,
  parentColumn: productPowerDraw.productId,
});

export const productAntennasRouter = createEntityRouter({
  table: productAntenna,
  idPrefix: 'pant',
  searchColumns: [productAntenna.connector],
  orderBy: productAntenna.type,
  parentColumn: productAntenna.productId,
});

export const productCertificationsRouter = createEntityRouter({
  table: productCertification,
  idPrefix: 'pcert',
  searchColumns: [productCertification.identifier],
  orderBy: productCertification.authority,
  parentColumn: productCertification.productId,
});

export const productFormFactorsRouter = createEntityRouter({
  table: productFormFactor,
  idPrefix: 'pff',
  orderBy: productFormFactor.conformance,
  parentColumn: productFormFactor.productId,
});

export const productEnvironmentsRouter = createEntityRouter({
  table: productEnvironment,
  idPrefix: 'penv',
  searchColumns: [productEnvironment.ingressRating],
  orderBy: productEnvironment.ingressRating,
  parentColumn: productEnvironment.productId,
});

export const productRevisionsRouter = createEntityRouter({
  table: productRevision,
  idPrefix: 'prev',
  searchColumns: [productRevision.revision, productRevision.summary],
  orderBy: productRevision.revision,
  parentColumn: productRevision.productId,
});

// ── Cross-entity claims ─────────────────────────────────────────────────────────────────

export const compatibilityClaimsRouter = createEntityRouter({
  table: compatibilityClaim,
  idPrefix: 'compat',
  searchColumns: [compatibilityClaim.summary],
  orderBy: compatibilityClaim.level,
  parentColumn: compatibilityClaim.subjectProductId,
});

export const compatibilityDeltasRouter = createEntityRouter({
  table: compatibilityDelta,
  idPrefix: 'delta',
  searchColumns: [compatibilityDelta.signal],
  orderBy: compatibilityDelta.signal,
  parentColumn: compatibilityDelta.claimId,
});

export const lifecycleEventsRouter = createEntityRouter({
  table: lifecycleEvent,
  idPrefix: 'life',
  searchColumns: [lifecycleEvent.summary],
  orderBy: lifecycleEvent.state,
  parentColumn: lifecycleEvent.productId,
});

export const longevityCommitmentsRouter = createEntityRouter({
  table: longevityCommitment,
  idPrefix: 'long',
  searchColumns: [longevityCommitment.wording],
  orderBy: longevityCommitment.scope,
  parentColumn: longevityCommitment.productId,
});

export const softwareSupportClaimsRouter = createEntityRouter({
  table: softwareSupportClaim,
  idPrefix: 'supp',
  searchColumns: [softwareSupportClaim.component, softwareSupportClaim.toolchain],
  orderBy: softwareSupportClaim.component,
  parentColumn: softwareSupportClaim.productId,
});

// ── Provenance and editorial ────────────────────────────────────────────────────────────

export const sourcesRouter = createEntityRouter({
  table: source,
  idPrefix: 'src',
  searchColumns: [source.title, source.url, source.publisher],
  orderBy: source.title,
  slugColumn: source.canonicalUrl,
});

export const claimsRouter = createEntityRouter({
  table: claim,
  idPrefix: 'clm',
  searchColumns: [claim.valueText, claim.quotedText],
  orderBy: claim.entityTable,
  parentColumn: claim.entityId,
});

export const changeProposalsRouter = createEntityRouter({
  table: changeProposal,
  idPrefix: 'prop',
  searchColumns: [changeProposal.title, changeProposal.summary],
  orderBy: changeProposal.title,
});

export const researchTasksRouter = createEntityRouter({
  table: researchTask,
  idPrefix: 'task',
  searchColumns: [researchTask.subject, researchTask.instructions],
  orderBy: researchTask.subject,
});
