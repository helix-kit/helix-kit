import { randomUUID } from 'crypto';

/**
 * Row ids. Prefixed with the entity so a bare id in a log, a claim's `entityId`, or a change
 * proposal patch is self-describing.
 */
export const createId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;

const SLUG_INVALID = /[^a-z0-9]+/g;
const SLUG_EDGES = /^-+|-+$/g;

/** URL-safe identifier derived from a name, used for every human-addressable entity. */
export const slugify = (value: string): string =>
  value.toLowerCase().replaceAll(SLUG_INVALID, '-').replaceAll(SLUG_EDGES, '');
