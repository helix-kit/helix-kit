import type { ReportDocument } from './types';

/**
 * The starting template: a device fleet report that binds every component
 * straight to one raw `devices` array, with no pre-shaping step.
 */
export const defaultReportDocument: ReportDocument = {
  spec: {
    root: 'doc',
    elements: {
      doc: {
        type: 'Document',
        props: {
          title: 'Helix fleet report',
          author: 'Helix',
          subject: 'Helix JSON report',
        },
        children: ['page'],
      },
      page: {
        // Rendered as the branded `ReportPage` — the Helix header/footer is
        // injected automatically and cannot be removed from a template.
        type: 'Page',
        props: { size: 'A4', orientation: null, backgroundColor: null },
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
        props: { text: { $state: '/reportTitle' }, level: 'h1', color: '#09090b', align: null },
        children: [],
      },
      summary: {
        type: 'Text',
        props: {
          text: { $state: '/reportSummary' },
          fontSize: 10,
          color: '#3f3f46',
          align: null,
          fontWeight: null,
          fontStyle: null,
          lineHeight: 1.5,
        },
        children: [],
      },

      'summary-section': {
        type: 'Section',
        props: { title: 'Fleet Summary', subtitle: null },
        children: ['metric-grid'],
      },
      'metric-grid': {
        type: 'MetricGrid',
        props: {},
        children: ['metric-devices', 'metric-uptime', 'metric-faults'],
      },
      'metric-devices': {
        type: 'MetricCard',
        props: { label: 'Devices Reporting', data: { $state: '/devices' }, agg: 'count' },
        children: [],
      },
      'metric-uptime': {
        type: 'MetricCard',
        props: {
          label: 'Total Uptime',
          data: { $state: '/devices' },
          agg: 'sum',
          path: 'uptimeSeconds',
          format: 'duration',
        },
        children: [],
      },
      'metric-faults': {
        type: 'MetricCard',
        props: {
          label: 'Total Faults',
          data: { $state: '/devices' },
          agg: 'sum',
          path: 'faults',
          format: 'integer',
          tone: 'danger',
          toneWhenAbove: 0,
        },
        children: [],
      },

      'fault-callout': {
        type: 'Callout',
        props: {
          text: '{count} device(s) reported at least one fault in this window.',
          tone: 'warning',
          data: { $state: '/devices' },
          where: [{ path: 'faults', op: 'gt', value: 0 }],
        },
        children: [],
      },

      'chart-section': {
        type: 'Section',
        props: { title: 'Events published by profile', subtitle: null },
        children: ['profile-chart'],
      },
      'profile-chart': {
        type: 'BarChart',
        props: {
          data: { $state: '/devices' },
          groupBy: 'profile',
          aggregation: 'sum',
          yKey: 'eventsPublished',
          title: null,
          width: 500,
          height: 190,
          showValues: true,
        },
        children: [],
      },

      'table-section': {
        type: 'Section',
        props: { title: 'Device Log', subtitle: null },
        children: ['device-table'],
      },
      'device-table': {
        type: 'DataTable',
        props: {
          data: { $state: '/devices' },
          columns: [
            { header: 'Device', path: 'name', width: '24%', align: 'left' },
            { header: 'Profile', path: 'profile', width: '18%', align: 'left' },
            { header: 'Last Seen', path: 'lastSeenAt', width: '22%', format: 'datetime' },
            {
              header: 'Uptime',
              path: 'uptimeSeconds',
              width: '16%',
              format: 'duration',
              align: 'center',
            },
            {
              header: 'Events',
              path: 'eventsPublished',
              width: '10%',
              format: 'integer',
              align: 'center',
            },
            { header: 'Faults', path: 'faults', width: '10%', format: 'integer', align: 'center' },
          ],
          rowHighlight: [{ path: 'faults', op: 'gt', value: 0, color: '#fee2e2' }],
          striped: true,
        },
        children: [],
      },
    },
  },
  demoData: {
    reportTitle: 'Weekly fleet report',
    reportSummary:
      'Sample report built from the shared Helix PDF component pack — metric tiles, a vector chart and a data table all bind straight to a raw array of device records.',
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
