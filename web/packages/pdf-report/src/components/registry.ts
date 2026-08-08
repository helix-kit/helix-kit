import { Callout } from './callout';
import { BarChart, LineChart, PieChart } from './charts';
import { DataTable } from './data-table';
import { GroupedTable } from './grouped-table';
import { KeepTogether, MetricCard, MetricGrid, Section } from './layout';
import { ReportPage } from './report-page';
import { SummaryTable } from './summary-table';

/**
 * Helix's custom json-render PDF components, layered on top of the standard
 * catalog (`Document`, `Page`, `View`, `Row`, `Column`, `Heading`, `Text`,
 * `Image`, `Link`, `Table`, `List`, `Divider`, `Spacer`, `PageNumber`).
 *
 * These exist because the stock catalog has no charts, no way to repeat a fixed
 * header/footer on every page, and a `Table` that only accepts pre-shaped
 * `string[][]` rows — which would push data shaping onto every caller.
 */
export const helixPdfComponents = {
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
} as const;
