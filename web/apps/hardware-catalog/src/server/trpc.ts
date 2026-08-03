import 'server-only';

import { createRootRouter } from '@helix/backend/trpc';

import { ANONYMOUS_ACTOR, type CatalogContext } from './context';
import { db } from './db';
import * as entities from './routers/entities';
import { imagesRouter } from './routers/images';
import { productEntityRouter, productsRouter } from './routers/product';
import { siliconEntityRouter, siliconRouter } from './routers/silicon';
import {
  architecturesRouter,
  connectorStandardsRouter,
  coreDesignsRouter,
  formFactorsRouter,
  manufacturersRouter,
  softwarePlatformsRouter,
} from './routers/taxonomy';

/**
 * The catalog's root router. Read and write are both open right now — authentication is
 * deliberately deferred (local development only), and every mutation already carries an actor
 * so the guard is added later without reshaping any procedure.
 */
export const { router: appRouter } = createRootRouter({
  // Taxonomy
  manufacturers: manufacturersRouter,
  architectures: architecturesRouter,
  coreDesigns: coreDesignsRouter,
  formFactors: formFactorsRouter,
  connectorStandards: connectorStandardsRouter,
  softwarePlatforms: softwarePlatformsRouter,

  // Silicon — the graph reads, then the write surface for the head and each child table
  silicon: siliconRouter,
  siliconEntity: siliconEntityRouter,
  siliconVariants: entities.siliconVariantsRouter,
  siliconComputeUnits: entities.siliconComputeUnitsRouter,
  siliconMemorySupport: entities.siliconMemorySupportRouter,
  siliconInterfaces: entities.siliconInterfacesRouter,
  siliconMediaCodecs: entities.siliconMediaCodecsRouter,
  siliconIsps: entities.siliconIspsRouter,
  siliconRadios: entities.siliconRadiosRouter,
  siliconSecurityFeatures: entities.siliconSecurityFeaturesRouter,
  acceleratorPerformance: entities.acceleratorPerformanceRouter,
  acceleratorPrecisions: entities.acceleratorPrecisionsRouter,

  // Products
  products: productsRouter,
  productEntity: productEntityRouter,
  productVariants: entities.productVariantsRouter,
  productCompositions: entities.productCompositionsRouter,
  productSilicon: entities.productSiliconRouter,
  productMemory: entities.productMemoryRouter,
  productStorage: entities.productStorageRouter,
  productExposedInterfaces: entities.productExposedInterfacesRouter,
  productConnectors: entities.productConnectorsRouter,
  productLinks: entities.productLinksRouter,
  priceEstimates: entities.priceEstimatesRouter,
  productImages: entities.productImagesRouter,
  images: imagesRouter,
  operatingModes: entities.operatingModesRouter,
  productPower: entities.productPowerRouter,
  productPowerDraw: entities.productPowerDrawRouter,
  productAntennas: entities.productAntennasRouter,
  productCertifications: entities.productCertificationsRouter,
  productFormFactors: entities.productFormFactorsRouter,
  productEnvironments: entities.productEnvironmentsRouter,
  productRevisions: entities.productRevisionsRouter,

  // Cross-entity claims
  compatibilityClaims: entities.compatibilityClaimsRouter,
  compatibilityDeltas: entities.compatibilityDeltasRouter,
  lifecycleEvents: entities.lifecycleEventsRouter,
  longevityCommitments: entities.longevityCommitmentsRouter,
  softwareSupportClaims: entities.softwareSupportClaimsRouter,

  // Provenance and editorial
  sources: entities.sourcesRouter,
  claims: entities.claimsRouter,
  changeProposals: entities.changeProposalsRouter,
  researchTasks: entities.researchTasksRouter,
});

export type AppRouter = typeof appRouter;

export const createTRPCContext = (): CatalogContext => ({ db, actor: ANONYMOUS_ACTOR });
