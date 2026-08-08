import { z } from 'zod';

import type { ReportTemplate } from './types';

const deviceSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  profile: z.string(),
  lastSeenAt: z.string(),
  uptimeSeconds: z.number(),
  eventsPublished: z.number(),
  faults: z.number(),
});

const inputSchema = z.object({
  reportTitle: z.string(),
  reportSummary: z.string(),
  devices: z.array(deviceSchema),
});

/**
 * What the code hands the presentation layer.
 *
 * Everything here is display-ready: strings are formatted, rows are ordered, and
 * chart points are aggregated. The spec only places them.
 */
const outputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  deviceCount: z.string(),
  totalUptime: z.string(),
  totalFaults: z.string(),
  faultNote: z.string(),
  eventsByProfile: z.array(z.object({ label: z.string(), value: z.number() })),
  tableHeaders: z.array(z.string()),
  tableRows: z.array(z.array(z.string())),
  tableRowColors: z.array(z.string().nullable()),
});

const CODE = `type Device = {
  deviceId: string;
  name: string;
  profile: string;
  lastSeenAt: string;
  uptimeSeconds: number;
  eventsPublished: number;
  faults: number;
};

const devices = input.devices as Device[];

const duration = (seconds: number): string => {
  const total = Math.max(Math.round(seconds), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return hours + "h " + minutes + "m " + rest + "s";
  if (minutes > 0) return minutes + "m " + rest + "s";
  return rest + "s";
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const faulted = devices.filter((device) => device.faults > 0);

// One point per profile, events summed within it.
const byProfile = new Map<string, number>();
for (const device of devices) {
  byProfile.set(device.profile, (byProfile.get(device.profile) ?? 0) + device.eventsPublished);
}

return {
  title: input.reportTitle,
  summary: input.reportSummary,
  deviceCount: String(devices.length),
  totalUptime: duration(sum(devices.map((device) => device.uptimeSeconds))),
  totalFaults: String(sum(devices.map((device) => device.faults))),
  faultNote:
    faulted.length === 0
      ? ""
      : faulted.length + " device(s) reported at least one fault in this window.",
  eventsByProfile: Array.from(byProfile, ([label, value]) => ({ label, value })),
  tableHeaders: ["Device", "Profile", "Last Seen", "Uptime", "Events", "Faults"],
  tableRows: devices.map((device) => [
    device.name,
    device.profile,
    new Date(device.lastSeenAt).toISOString().replace("T", " ").slice(0, 16),
    duration(device.uptimeSeconds),
    String(device.eventsPublished),
    String(device.faults),
  ]),
  // Tinting is a decision about the data, so the code makes it.
  tableRowColors: devices.map((device) => (device.faults > 0 ? "#fee2e2" : null)),
};
`;

/**
 * The starting template: a device fleet report.
 *
 * Deliberately exercises the split — the code aggregates, formats and decides
 * row tinting, and every component below simply places a value it was handed.
 */
export const defaultReportTemplate: ReportTemplate = {
  inputSchema: z.toJSONSchema(inputSchema),
  outputSchema: z.toJSONSchema(outputSchema),
  code: CODE,
  spec: {
    root: 'doc',
    elements: {
      doc: {
        type: 'Document',
        props: { title: 'Helix fleet report', author: 'Helix', subject: 'Helix report' },
        children: ['page'],
      },
      page: {
        // Rendered as the branded `ReportPage` — the header/footer is injected
        // at render time and cannot be removed by a template.
        type: 'Page',
        props: { size: 'A4' },
        children: [
          'title',
          'summary',
          'summary-section',
          'fault-callout',
          'chart-section',
          'table-section',
        ],
      },
      title: {
        type: 'Heading',
        props: { text: { $state: '/title' }, level: 'h1', color: '#09090b' },
        children: [],
      },
      summary: {
        type: 'Text',
        props: { text: { $state: '/summary' }, fontSize: 10, color: '#3f3f46', lineHeight: 1.5 },
        children: [],
      },

      'summary-section': {
        type: 'Section',
        props: { title: 'Fleet Summary' },
        children: ['metric-grid'],
      },
      'metric-grid': {
        type: 'MetricGrid',
        props: {},
        children: ['metric-devices', 'metric-uptime', 'metric-faults'],
      },
      'metric-devices': {
        type: 'MetricCard',
        props: { label: 'Devices Reporting', value: { $state: '/deviceCount' } },
        children: [],
      },
      'metric-uptime': {
        type: 'MetricCard',
        props: { label: 'Total Uptime', value: { $state: '/totalUptime' } },
        children: [],
      },
      'metric-faults': {
        type: 'MetricCard',
        props: { label: 'Total Faults', value: { $state: '/totalFaults' }, tone: 'danger' },
        children: [],
      },

      'fault-callout': {
        type: 'Callout',
        props: { text: { $state: '/faultNote' }, tone: 'warning' },
        children: [],
      },

      'chart-section': {
        type: 'Section',
        props: { title: 'Events published by profile' },
        children: ['profile-chart'],
      },
      'profile-chart': {
        type: 'BarChart',
        props: {
          series: { $state: '/eventsByProfile' },
          width: 500,
          height: 190,
          showValues: true,
        },
        children: [],
      },

      'table-section': {
        type: 'Section',
        props: { title: 'Device Log' },
        children: ['device-table'],
      },
      'device-table': {
        type: 'DataTable',
        props: {
          headers: { $state: '/tableHeaders' },
          rows: { $state: '/tableRows' },
          rowColors: { $state: '/tableRowColors' },
          columnWidths: ['24%', '18%', '22%', '16%', '10%', '10%'],
          align: ['left', 'left', 'left', 'center', 'center', 'center'],
          striped: true,
        },
        children: [],
      },
    },
  },
  demoInput: {
    reportTitle: 'Weekly fleet report',
    reportSummary:
      'Sample report built from the shared Helix PDF component pack. The code step aggregates and formats; the components only place what it produced.',
    devices: [
      {
        deviceId: 'dev_01H8Z',
        name: 'gateway-pune-01',
        profile: 'edge-gateway',
        lastSeenAt: '2026-08-06T09:12:44.000Z',
        uptimeSeconds: 601_240,
        eventsPublished: 18_422,
        faults: 0,
      },
      {
        deviceId: 'dev_01H8A',
        name: 'sensor-line-a-07',
        profile: 'esp32-sensor',
        lastSeenAt: '2026-08-06T09:11:02.000Z',
        uptimeSeconds: 84_930,
        eventsPublished: 9_105,
        faults: 3,
      },
      {
        deviceId: 'dev_01H8B',
        name: 'sensor-line-a-08',
        profile: 'esp32-sensor',
        lastSeenAt: '2026-08-06T08:57:19.000Z',
        uptimeSeconds: 172_800,
        eventsPublished: 11_780,
        faults: 0,
      },
      {
        deviceId: 'dev_01H8C',
        name: 'camera-dock-02',
        profile: 'radxa-vision',
        lastSeenAt: '2026-08-06T09:12:51.000Z',
        uptimeSeconds: 259_140,
        eventsPublished: 42_610,
        faults: 12,
      },
      {
        deviceId: 'dev_01H8D',
        name: 'camera-dock-03',
        profile: 'radxa-vision',
        lastSeenAt: '2026-08-05T22:04:10.000Z',
        uptimeSeconds: 38_400,
        eventsPublished: 6_240,
        faults: 0,
      },
    ],
  },
};
