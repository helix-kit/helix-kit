import { randomBytes } from 'node:crypto';

const ID_BYTES = 16;

// Prefixed, sortable-enough opaque IDs (no ULID dep; mirrors writer.ts's
// node:crypto usage). e.g. prefixedId('art') -> 'art_<32 hex>'.
export const prefixedId = (prefix: string): string =>
  `${prefix}_${randomBytes(ID_BYTES).toString('hex')}`;
