import { randomUUID } from 'crypto';

/**
 * Row ids. Prefixed with the entity so a bare id in a log, a claim's `entityId`, or a change
 * proposal patch is self-describing.
 */
export const createId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
