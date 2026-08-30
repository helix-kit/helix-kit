import { defineRegistry } from '@json-render/react-pdf';

import { Callout } from './callout';
import { BarChart, LineChart, PieChart } from './charts';
import { DataTable } from './data-table';
import { KeepTogether, MetricCard, MetricGrid, Section } from './layout';
import { ReportPage } from './report-page';
import { defaultReportPalette, type ReportPalette } from './theme';

import { helixPackCatalog } from '../catalog';

/**
 * Binds the Helix report components to their catalog declarations.
 *
 * `defineRegistry` is what ties each implementation to its declared props: a
 * component whose signature drifts from its zod schema fails to compile, and a
 * declared component with no implementation is caught too. It also resolves
 * `element.props`, so components receive resolved props directly.
 *
 * Only the Helix pack is listed — the standard catalog (`Document`, `Page`,
 * `View`, `Row`, `Column`, `Heading`, `Text`, `Image`, `Link`, `Table`, `List`,
 * `Divider`, `Spacer`, `PageNumber`) is merged in by the renderer's
 * `includeStandard`, which defaults to true.
 *
 * This import reaches the package root, which builds React contexts at module
 * scope, so a host must not let Next bundle it under the `react-server`
 * condition. `serverExternalPackages: ['@react-pdf/renderer',
 * '@json-render/react-pdf']` is what upstream's own react-pdf example ships;
 * see this package's README.
 */
/**
 * Builds the registry with a palette baked into the components that use one.
 *
 * A React context would be the obvious way to pass this down, but a context
 * built at module scope is exactly what makes a package unbundleable under
 * Next's `react-server` condition — the problem the note above describes. A
 * closure has no such constraint, and the palette is fixed for a render anyway.
 */
export const createHelixPdfComponents = (palette: ReportPalette = defaultReportPalette) =>
  defineRegistry(helixPackCatalog, {
    components: {
      ReportPage,
      Section: (input) => Section(input, palette),
      MetricGrid,
      MetricCard: (input) => MetricCard(input, palette),
      DataTable,
      Callout: (input) => Callout(input, palette),
      BarChart: (input) => BarChart(input, palette),
      LineChart: (input) => LineChart(input, palette),
      PieChart: (input) => PieChart(input, palette),
      KeepTogether,
    },
  }).registry;

/** The default registry, in Helix's own palette. */
export const helixPdfComponents = createHelixPdfComponents();
