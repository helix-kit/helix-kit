import type { ReactNode } from 'react';

import type { UIElement } from '@json-render/core';

/**
 * The contract every json-render PDF component is rendered with. Mirrors
 * `ComponentRenderProps` from `@json-render/react-pdf`, restated locally so the
 * component pack does not depend on that package's internal type export path.
 * `element.props` arrives with all `$state` / `$item` bindings already resolved.
 */
export type ComponentRenderProps<P = Record<string, unknown>> = {
  element: UIElement<string, P>;
  children?: ReactNode;
};
