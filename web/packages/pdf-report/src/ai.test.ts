import { composeAssistant, extendCapability } from '@helix/ai-kit';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { reportAuthoring, reportCapabilities, REPORT_ARTIFACTS } from './ai';
import { defaultReportTemplate } from './defaults';

import type { ReportTemplate } from './types';

const toolNamed = (name: string) => {
  const composed = composeAssistant(reportCapabilities({ template: defaultReportTemplate }));
  const tool = composed.tools.find((entry) => entry.name === name);
  if (tool === undefined) {
    throw new Error(`No tool named ${name}.`);
  }
  return tool;
};

const check = (template: ReportTemplate) => toolNamed('check_report').execute(template);

describe('the composed report assistant', () => {
  it('composes without a name or kind collision', () => {
    expect(() => composeAssistant(reportCapabilities())).not.toThrow();
  });

  it('offers the checks that make a generated template verifiable', () => {
    const composed = composeAssistant(reportCapabilities());

    expect(composed.tools.map((tool) => tool.name).sort()).toEqual([
      'check_report',
      'check_schema',
      'try_code',
    ]);
  });

  it('declares every part of a template as its own artifact', () => {
    const composed = composeAssistant(reportCapabilities());

    expect(composed.artifacts.map((artifact) => artifact.kind)).toEqual(
      REPORT_ARTIFACTS.map((artifact) => artifact.kind),
    );
  });

  it('streams the layout as patches and replaces everything else', () => {
    const byKind = new Map(REPORT_ARTIFACTS.map((artifact) => [artifact.kind, artifact.mode]));

    expect(byKind.get('report.layout')).toBe('jsonl-patch');
    expect(byKind.get('report.code')).toBe('replace');
  });

  it('tells the model what a report is before how to write its parts', () => {
    const composed = composeAssistant(reportCapabilities());
    const ids = composed.sections.map((section) => section.id);

    expect(ids.indexOf('report.tiers')).toBeLessThan(ids.indexOf('code.contract'));
  });

  it('describes the real component vocabulary rather than a fixed list', () => {
    const composed = composeAssistant(reportCapabilities());

    // Sourced from the catalog, so a component added to the pack reaches the
    // model without anyone remembering to update a prompt.
    expect(composed.system).toContain('MetricCard');
    expect(composed.system).toContain('DataTable');
  });

  it('types `input` from the template being worked on', () => {
    const composed = composeAssistant(reportCapabilities({ template: defaultReportTemplate }));

    expect(composed.system).toContain('declare const input:');
    expect(composed.system).toContain('uptimeSeconds');
  });
});

describe('check_report', () => {
  it('accepts the default template and returns what the page will draw', async () => {
    const result = (await check(defaultReportTemplate)) as { valid: boolean; data: unknown };

    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({ deviceCount: '5', totalUptime: '321h 15m 10s' });
  });

  it('rejects a binding the output schema does not produce, naming the element', async () => {
    const broken: ReportTemplate = {
      ...defaultReportTemplate,
      spec: {
        ...defaultReportTemplate.spec,
        elements: {
          ...defaultReportTemplate.spec.elements,
          deviceCountCard: {
            type: 'MetricCard',
            props: { label: 'Devices', value: { $state: '/deviceCountt' } },
            children: [],
          },
        },
      },
    };

    const result = (await check(broken)) as { valid: boolean; error: string };

    expect(result.valid).toBe(false);
    expect(result.error).toContain('deviceCountCard');
  });

  it('reports a code failure with the logs that explain it', async () => {
    const result = (await check({
      ...defaultReportTemplate,
      code: 'console.log("reached the aggregation"); throw new Error("boom");',
    })) as { valid: boolean; stage: string; error: string };

    expect(result.valid).toBe(false);
    expect(result.stage).toBe('pipeline');
    expect(result.error).toContain('reached the aggregation');
  });

  it('reports an unknown component as a layout problem', async () => {
    const result = (await check({
      ...defaultReportTemplate,
      spec: {
        root: 'doc',
        elements: {
          doc: { type: 'Document', props: {}, children: ['page'] },
          page: { type: 'Page', props: {}, children: ['nope'] },
          nope: { type: 'Sparkline', props: {}, children: [] },
        },
      },
    })) as { valid: boolean; stage: string };

    expect(result.valid).toBe(false);
    expect(result.stage).toBe('layout');
  });
});

describe('try_code', () => {
  it('runs a candidate against the template demo input', async () => {
    const result = (await toolNamed('try_code').execute({
      code: defaultReportTemplate.code,
    })) as { success: boolean; output: Record<string, unknown> };

    // No input supplied, so the sample the capability was built with is used.
    expect(result.success).toBe(true);
    expect(result.output.deviceCount).toBe('5');
  });

  it('rejects code that does not return the declared output shape', async () => {
    const result = (await toolNamed('try_code').execute({
      code: 'return { count: input.devices.length };',
    })) as { success: boolean; error: string; output: unknown };

    // The check that makes the two tiers hold: the layout binds to the output
    // schema, so code returning something else would render a blank page.
    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/[Oo]utput/);
  });

  it('accepts input supplied by the model, over the sample', async () => {
    const result = (await toolNamed('try_code').execute({
      code: defaultReportTemplate.code,
      input: { reportTitle: 'Empty', reportSummary: 'None.', devices: [] },
    })) as { success: boolean; output: Record<string, unknown> };

    expect(result.output.deviceCount).toBe('0');
  });

  it('returns the error rather than throwing, so a model can act on it', async () => {
    const result = (await toolNamed('try_code').execute({
      code: 'return input.devices.missing.length;',
    })) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('check_schema', () => {
  it('reports the TypeScript a schema produces', async () => {
    const result = (await toolNamed('check_schema').execute({
      schema: z.toJSONSchema(z.object({ total: z.number() })),
    })) as { supported: boolean; type: string };

    expect(result.supported).toBe(true);
    expect(result.type).toContain('total: number');
  });

  it('says plainly when part of a schema will be dropped', async () => {
    const result = (await toolNamed('check_schema').execute({
      // `allOf` survives neither the editor model nor the round trip.
      schema: { type: 'object', properties: { a: { allOf: [{ type: 'string' }] } } },
    })) as { note?: string; effectiveSchema?: unknown };

    expect(result.note).toBeDefined();
    expect(result.effectiveSchema).toBeDefined();
  });
});

describe('extending a capability', () => {
  it('replaces what a section says without disturbing the others', () => {
    const base = reportAuthoring();
    const extended = extendCapability(base, {
      sections: [
        { id: 'report.tiers', title: 'How a report is built', body: 'Host-specific rules.' },
      ],
    });

    expect(extended.sections).toHaveLength(base.sections.length);
    expect(extended.sections[0]?.body).toBe('Host-specific rules.');
    expect(extended.sections[1]).toEqual(base.sections[1]);
  });
});
