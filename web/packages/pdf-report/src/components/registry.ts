import { defineRegistry } from '@json-render/react-pdf';

import { Callout } from './callout';
import { BarChart, LineChart, PieChart } from './charts';
import { DataTable } from './data-table';
import { KeepTogether, MetricCard, MetricGrid, Section } from './layout';
import { ReportPage } from './report-page';

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
export const { registry: helixPdfComponents } = defineRegistry(helixPackCatalog, {
  components: {
    ReportPage,
    Section,
    MetricGrid,
    MetricCard,
    DataTable,
    Callout,
    BarChart,
    LineChart,
    PieChart,
    KeepTogether,
  },
});
