import type { ReactNode } from 'react';

/**
 * What a catalog-bound component is handed. `defineRegistry` adapts the raw
 * element into this, so props arrive already resolved — every `$state` / `$item`
 * binding substituted.
 *
 * The prop types themselves come from the catalog's zod schemas; binding the
 * registry to the catalog is what checks a component against its declaration.
 */
export type RenderProps<P> = {
  props: P;
  children?: ReactNode;
};
