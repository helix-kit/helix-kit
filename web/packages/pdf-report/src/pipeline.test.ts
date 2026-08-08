import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defaultReportTemplate } from './defaults';
import { resolveReportTemplate } from './document';
import { prepareReport } from './pipeline';
import { renderReportToBuffer } from './server';

import type { ReportTemplate } from './types';

const PDF_MAGIC = '%PDF-';

const decode = (pdf: Uint8Array): string => Buffer.from(pdf).toString('latin1');

/** A minimal two-tier template, for isolating one behaviour at a time. */
const template = (overrides: Partial<ReportTemplate> = {}): ReportTemplate => ({
  inputSchema: z.toJSONSchema(z.object({ count: z.number() })),
  outputSchema: z.toJSONSchema(z.object({ label: z.string() })),
  code: 'return { label: "count: " + input.count };',
  spec: {
    root: 'doc',
    elements: {
      doc: { type: 'Document', props: {}, children: ['page'] },
      page: { type: 'Page', props: { size: 'A4' }, children: ['card'] },
      card: {
        type: 'MetricCard',
        props: { label: 'Count', value: { $state: '/label' } },
        children: [],
      },
    },
  },
  demoInput: { count: 3 },
  ...overrides,
});

describe('prepareReport', () => {
  it('runs the code and returns its output as the render state', async () => {
    const prepared = await prepareReport(template());

    expect(prepared.data).toEqual({ label: 'count: 3' });
  });

  it('uses supplied input over the template demo input', async () => {
    const prepared = await prepareReport(template(), { input: { count: 99 } });

    expect(prepared.data).toEqual({ label: 'count: 99' });
  });

  it('rejects input that does not match the input schema', async () => {
    await expect(prepareReport(template(), { input: { count: 'three' } })).rejects.toThrow(/Input/);
  });

  it('rejects output that does not match the output schema', async () => {
    await expect(prepareReport(template({ code: 'return { label: 42 };' }))).rejects.toThrow(
      /Output/,
    );
  });

  it('carries the code logs into the failure, since they are what explains it', async () => {
    await expect(
      prepareReport(template({ code: 'console.log("got this far"); throw new Error("boom");' })),
    ).rejects.toThrow(/got this far/);
  });

  it('returns logs from a successful run too', async () => {
    const prepared = await prepareReport(
      template({ code: 'console.log("working"); return { label: "x" };' }),
    );

    expect(prepared.logs).toEqual(['working']);
  });

  it('stamps branding onto the page rather than trusting the template', async () => {
    const prepared = await prepareReport(template(), { branding: { title: 'Fleet' } });

    const page = prepared.spec.elements.page as { type: string; props: Record<string, unknown> };
    expect(page.type).toBe('ReportPage');
    expect(page.props.brandTitle).toBe('Fleet');
  });
});

describe('binding validation', () => {
  it('rejects a binding the output schema does not produce', async () => {
    const broken = template({
      spec: {
        root: 'doc',
        elements: {
          doc: { type: 'Document', props: {}, children: ['page'] },
          page: { type: 'Page', props: {}, children: ['card'] },
          card: {
            type: 'MetricCard',
            // `/labl` is a typo; without this check it renders empty.
            props: { label: 'Count', value: { $state: '/labl' } },
            children: [],
          },
        },
      },
    });

    await expect(prepareReport(broken)).rejects.toThrow(/"\/labl" is not produced/);
  });

  it('accepts a binding into a nested path that does exist', async () => {
    const nested = template({
      outputSchema: z.toJSONSchema(z.object({ totals: z.object({ label: z.string() }) })),
      code: 'return { totals: { label: "ok" } };',
      spec: {
        root: 'doc',
        elements: {
          doc: { type: 'Document', props: {}, children: ['page'] },
          page: { type: 'Page', props: {}, children: ['card'] },
          card: {
            type: 'MetricCard',
            props: { label: 'Count', value: { $state: '/totals/label' } },
            children: [],
          },
        },
      },
    });

    await expect(prepareReport(nested)).resolves.toBeDefined();
  });

  it('names the element carrying the bad binding', async () => {
    const broken = template({
      spec: {
        root: 'doc',
        elements: {
          doc: { type: 'Document', props: {}, children: ['page'] },
          page: { type: 'Page', props: {}, children: ['card'] },
          card: {
            type: 'MetricCard',
            props: { label: 'Count', value: { $state: '/missing' } },
            children: [],
          },
        },
      },
    });

    await expect(prepareReport(broken)).rejects.toThrow(/card/);
  });
});

describe('the default template', () => {
  it('renders to a real PDF', async () => {
    const pdf = await renderReportToBuffer(defaultReportTemplate, {
      branding: { title: 'Fleet report', generatedAt: 'Thu, 06 Aug 2026 09:00:00 GMT' },
    });

    expect(decode(pdf).startsWith(PDF_MAGIC)).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });

  it('computes the summary values its layout binds to', async () => {
    const prepared = await prepareReport(defaultReportTemplate);

    expect(prepared.data.deviceCount).toBe('5');
    // 601240 + 84930 + 172800 + 259140 + 38400 = 1156510s
    expect(prepared.data.totalUptime).toBe('321h 15m 10s');
    expect(prepared.data.totalFaults).toBe('15');
    expect(prepared.data.faultNote).toContain('2 device(s)');
  });

  it('aggregates the chart per profile, not per device', async () => {
    const prepared = await prepareReport(defaultReportTemplate);

    expect(prepared.data.eventsByProfile).toEqual([
      { label: 'edge-gateway', value: 18_422 },
      { label: 'esp32-sensor', value: 20_885 },
      { label: 'radxa-vision', value: 48_850 },
    ]);
  });

  it('emits one table row per device, with tinting decided in code', async () => {
    const prepared = await prepareReport(defaultReportTemplate);

    expect(prepared.data.tableRows).toHaveLength(5);
    expect(prepared.data.tableRowColors).toEqual([null, '#fee2e2', null, '#fee2e2', null]);
  });

  it('says nothing about faults when there are none', async () => {
    const clean = {
      reportTitle: 'Clean',
      reportSummary: 'No faults.',
      devices: [
        {
          deviceId: 'a',
          name: 'a',
          profile: 'p',
          lastSeenAt: '2026-08-06T09:00:00.000Z',
          uptimeSeconds: 60,
          eventsPublished: 1,
          faults: 0,
        },
      ],
    };

    const prepared = await prepareReport(defaultReportTemplate, { input: clean });

    // An empty string is how a template hides a Callout.
    expect(prepared.data.faultNote).toBe('');
  });

  it('renders with no devices at all', async () => {
    const pdf = await renderReportToBuffer(defaultReportTemplate, {
      input: { reportTitle: 'Empty', reportSummary: 'Nothing reported.', devices: [] },
    });

    expect(decode(pdf).startsWith(PDF_MAGIC)).toBe(true);
  });
});

describe('resolveReportTemplate', () => {
  it('falls back to the default for junk input', () => {
    expect(resolveReportTemplate(null)).toEqual(defaultReportTemplate);
    expect(resolveReportTemplate('nope')).toEqual(defaultReportTemplate);
  });

  it('falls back per field, so one bad pane does not discard the others', () => {
    const resolved = resolveReportTemplate({
      code: 'return { label: "kept" };',
      spec: 'not a spec',
    });

    expect(resolved.code).toBe('return { label: "kept" };');
    expect(resolved.spec).toEqual(defaultReportTemplate.spec);
  });

  it('deep-clones, so a caller cannot mutate the default', () => {
    const resolved = resolveReportTemplate(defaultReportTemplate);

    expect(resolved.spec).not.toBe(defaultReportTemplate.spec);
    expect(resolved.inputSchema).not.toBe(defaultReportTemplate.inputSchema);
  });
});
