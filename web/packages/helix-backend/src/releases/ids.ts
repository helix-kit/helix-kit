import { randomBytes } from 'node:crypto';

const ID_BYTES = 16;

// Prefixed opaque IDs, e.g. prefixedId('art') -> 'art_<32 hex>'.
export const prefixedId = (prefix: string): string =>
  `${prefix}_${randomBytes(ID_BYTES).toString('hex')}`;
