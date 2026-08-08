import type { ComponentType, ReactNode } from 'react';

import { Callout } from './callout';
import { BarChart, LineChart, PieChart } from './charts';
import { DataTable } from './data-table';
import { GroupedTable } from './grouped-table';
import { KeepTogether, MetricCard, MetricGrid, Section } from './layout';
import { ReportPage } from './report-page';
import { SummaryTable } from './summary-table';

import type { HelixPackCatalog } from '../catalog';
import type { UIElement } from '@json-render/core';
import type { Components } from '@json-render/react-pdf/server';

/**
 * The Helix report components, typed against their catalog declarations.
 *
 * `Components<HelixPackCatalog>` is what ties each implementation to its zod
 * schema: a component whose props drift from the declaration fails to compile,
 * and every declared component must be implemented.
 */
const components: Components<HelixPackCatalog> = {
  ReportPage,
  Section,
  MetricGrid,
  MetricCard,
  DataTable,
  GroupedTable,
  SummaryTable,
  Callout,
  BarChart,
  LineChart,
  PieChart,
  KeepTogether,
};

type ElementProps = {
  element: UIElement;
  children?: ReactNode;
  emit?: (event: string) => void;
  bindings?: Record<string, string>;
  loading?: boolean;
};

/**
 * Adapts a catalog component to the element-shaped renderer contract.
 *
 * This is what `defineRegistry` does at runtime. It is done here because that
 * helper ships only from the package root, which builds four React contexts at
 * module scope (`StateContext`, `VisibilityContext`, `ActionContext`,
 * `ValidationContext`). Under Next's `react-server` condition `createContext`
 * does not exist, so importing it from a route handler throws — whereas
 * `@json-render/react-pdf/render` is documented as the hook-free server entry.
 *
 * `serverExternalPackages: ['@json-render/react-pdf']` in the host's Next config
 * does fix it (verified). We do not rely on that: it would make this package's
 * server entry drag a client-only module into every consumer's render path, and
 * force each adopter to add that line or hit the same opaque error. The library
 * contributes the *typing* (`Components<HelixPackCatalog>` above, from the
 * server-safe entry) — the runtime part is a loop, so it lives here instead.
 *
 * Upstream: https://github.com/vercel-labs/json-render/issues/317 — drop this
 * once `defineRegistry` ships from a server-safe subpath.
 */
const toElementComponent =
  (render: (typeof components)[keyof typeof components]): ComponentType<ElementProps> =>
  ({ element, children, emit, bindings, loading }: ElementProps) =>
    render({
      props: element.props as never,
      children,
      emit: emit ?? (() => undefined),
      bindings,
      loading,
    });

/**
 * The registry handed to the renderer.
 *
 * Only the Helix pack is listed — the standard catalog (`Document`, `Page`,
 * `View`, `Row`, `Column`, `Heading`, `Text`, `Image`, `Link`, `Table`, `List`,
 * `Divider`, `Spacer`, `PageNumber`) is merged in by the renderer's
 * `includeStandard`, which defaults to true.
 */
export const helixPdfComponents: Record<string, ComponentType<ElementProps>> = Object.fromEntries(
  Object.entries(components).map(([name, render]) => [name, toElementComponent(render)]),
);
