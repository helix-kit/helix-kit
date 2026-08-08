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
 * This is what `defineRegistry` does at runtime, done here because that helper
 * only ships from the package root, which pulls in the React context providers
 * (`StateProvider`, `ActionProvider`, …). Importing those from a Next.js route
 * handler blows up on `createContext`, whereas `@json-render/react-pdf/render`
 * is explicitly the hook-free server entry point. The typing above still comes
 * from the library, so the catalog binding is unaffected.
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
