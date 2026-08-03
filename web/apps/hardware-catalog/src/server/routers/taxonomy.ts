import { createEntityRouter } from './crud';

import {
  architecture,
  connectorStandard,
  coreDesign,
  formFactor,
  manufacturer,
  softwarePlatform,
} from '../schema';

/** Shared vocabulary. Plain CRUD — the interesting reads join through these, not into them. */

export const manufacturersRouter = createEntityRouter({
  table: manufacturer,
  idPrefix: 'mfr',
  searchColumns: [manufacturer.name, manufacturer.slug, manufacturer.legalName],
  orderBy: manufacturer.name,
  slugColumn: manufacturer.slug,
});

export const architecturesRouter = createEntityRouter({
  table: architecture,
  idPrefix: 'arch',
  searchColumns: [architecture.name, architecture.slug, architecture.baseIsa],
  orderBy: architecture.name,
  slugColumn: architecture.slug,
});

export const coreDesignsRouter = createEntityRouter({
  table: coreDesign,
  idPrefix: 'core',
  searchColumns: [coreDesign.name, coreDesign.slug, coreDesign.microarchitecture],
  orderBy: coreDesign.name,
  parentColumn: coreDesign.architectureId,
  slugColumn: coreDesign.slug,
});

export const formFactorsRouter = createEntityRouter({
  table: formFactor,
  idPrefix: 'ff',
  searchColumns: [formFactor.name, formFactor.slug, formFactor.standardBody],
  orderBy: formFactor.name,
  slugColumn: formFactor.slug,
});

export const connectorStandardsRouter = createEntityRouter({
  table: connectorStandard,
  idPrefix: 'conn',
  searchColumns: [connectorStandard.name, connectorStandard.slug],
  orderBy: connectorStandard.name,
  slugColumn: connectorStandard.slug,
});

export const softwarePlatformsRouter = createEntityRouter({
  table: softwarePlatform,
  idPrefix: 'swp',
  searchColumns: [softwarePlatform.name, softwarePlatform.slug],
  orderBy: softwarePlatform.name,
  slugColumn: softwarePlatform.slug,
});
