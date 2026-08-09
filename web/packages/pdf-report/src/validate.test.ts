import { describe, expect, it } from 'vitest';

import { reportCatalog } from './catalog';
import { defaultReportTemplate } from './defaults';
import { reportSpecJsonSchema } from './schema';
import { validateReportSpec } from './validate';

import type { Spec } from '@json-render/core';

const spec = (elements: Record<string, unknown>, root = 'doc'): Spec =>
  ({ root, elements }) as unknown as Spec;

const page = (children: string[]) => ({
  doc: { type: 'Document', props: {}, children: ['page'] },
  page: { type: 'Page', props: { size: 'A4' }, children },
});

const messages = (value: Spec): string[] =>
  validateReportSpec(value).map((issue) =>
    issue.elementKey === undefined ? issue.message : `${issue.elementKey}: ${issue.message}`,
  );

describe('validateReportSpec', () => {
  it('accepts the default template', () => {
    expect(validateReportSpec(defaultReportTemplate.spec)).toEqual([]);
  });

  it('accepts hand-authored templates that omit optional props', () => {
    // The stock catalog declares every prop nullable-but-present; a template
    // written by hand omits what it does not set.
    expect(validateReportSpec(spec(page([])))).toEqual([]);
  });

  it('names an unknown component and lists what is available', () => {
    const issues = messages(spec({ ...page(['x']), x: { type: 'Nope', props: {}, children: [] } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('x: Unknown component "Nope"');
    expect(issues[0]).toContain('MetricCard');
  });

  it('catches a prop of the wrong type', () => {
    const issues = messages(
      spec({
        ...page(['s']),
        s: { type: 'Section', props: { title: 42 }, children: [] },
      }),
    );
    expect(issues).toEqual(['s: Section — title: Invalid input: expected string, received number']);
  });

  it('catches an invalid enum value', () => {
    const issues = messages(
      spec({
        ...page(['m']),
        m: {
          type: 'MetricCard',
          props: { label: 'x', value: 'y', tone: 'sideways' },
          children: [],
        },
      }),
    );
    expect(issues[0]).toContain('m: MetricCard — tone');
  });

  it('catches a missing required prop', () => {
    const issues = messages(
      spec({ ...page(['m']), m: { type: 'MetricCard', props: {}, children: [] } }),
    );
    expect(issues[0]).toContain('m: MetricCard — label');
  });

  it('catches a malformed nested column definition', () => {
    const issues = messages(
      spec({
        ...page(['t']),
        t: {
          type: 'DataTable',
          props: { headers: ['Device'], rows: [['a']], align: ['sideways'] },
          children: [],
        },
      }),
    );
    expect(issues[0]).toContain('t: DataTable — align.0');
  });

  it('does not flag a bound prop, whose shape is only known at render time', () => {
    const issues = messages(
      spec({
        ...page(['s']),
        s: { type: 'Section', props: { title: { $state: '/reportTitle' } }, children: [] },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('reports structural problems as well as prop problems', () => {
    const issues = messages(
      spec({
        ...page(['missing', 's']),
        s: { type: 'Section', props: { title: 42 }, children: [] },
      }),
    );
    expect(issues.some((issue) => issue.includes('missing'))).toBe(true);
    expect(issues.some((issue) => issue.includes('Section — title'))).toBe(true);
  });

  it('collects every issue rather than stopping at the first', () => {
    const issues = messages(
      spec({
        ...page(['a', 'b']),
        a: { type: 'Nope', props: {}, children: [] },
        b: { type: 'Section', props: { title: 42 }, children: [] },
      }),
    );
    expect(issues).toHaveLength(2);
  });
});

describe('reportCatalog', () => {
  it('declares the stock catalog plus the Helix pack', () => {
    expect(reportCatalog.componentNames).toContain('Heading');
    expect(reportCatalog.componentNames).toContain('MetricCard');
    expect(reportCatalog.componentNames).toContain('DataTable');
  });

  it('generates a system prompt describing the Helix components and their props', () => {
    const prompt = reportCatalog.prompt();
    expect(prompt).toContain('MetricCard');
    expect(prompt).toContain('A KPI tile');
    // Prop shapes reach the model through the prompt, not the JSON Schema.
    expect(prompt).toContain('rowColors');
  });
});

describe('reportSpecJsonSchema', () => {
  const schema = reportSpecJsonSchema() as {
    properties: {
      elements: {
        additionalProperties: { required: string[]; properties: { type: { enum: string[] } } };
      };
    };
  };

  it('enumerates every available component for editor completion', () => {
    const names = schema.properties.elements.additionalProperties.properties.type.enum;

    // Stock catalog and Helix pack alike, so completion covers the whole
    // vocabulary a template may use.
    expect(names).toContain('Document');
    expect(names).toContain('Heading');
    expect(names).toContain('DataTable');
    expect(names).toContain('MetricCard');
    expect(names).toContain('BarChart');
  });

  it('does not require `visible`, which hand-authored templates omit', () => {
    expect(schema.properties.elements.additionalProperties.required).not.toContain('visible');
  });

  it('rejects a child listed twice in the same container', () => {
    // Exactly what a recorded turn produced: the model inserted a new section
    // before the table with `add .../children/5`, which already shifts the table
    // down, and then "moved" the table by adding it again at 6. The report drew
    // the device table twice and every other check passed, because a duplicate
    // child is valid and renders perfectly well.
    const spec = {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: {
          type: 'Page',
          props: {},
          children: ['chart-section', 'lastseen-section', 'table-section', 'table-section'],
        },
        'chart-section': { type: 'Section', props: { title: 'Chart' }, children: [] },
        'lastseen-section': { type: 'Section', props: { title: 'Last seen' }, children: [] },
        'table-section': { type: 'Section', props: { title: 'Devices' }, children: [] },
      },
    } as unknown as Parameters<typeof validateReportSpec>[0];

    const issues = validateReportSpec(spec);

    expect(issues).toContainEqual(
      expect.objectContaining({
        elementKey: 'page',
        message: expect.stringContaining('listed more than once') as unknown as string,
      }),
    );
  });

  it('reports a duplicated child once, not once per repeat', () => {
    const spec = {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: {}, children: ['a', 'a', 'a'] },
        a: { type: 'Section', props: { title: 'A' }, children: [] },
      },
    } as unknown as Parameters<typeof validateReportSpec>[0];

    const duplicates = validateReportSpec(spec).filter((issue) =>
      issue.message.includes('listed more than once'),
    );

    expect(duplicates).toHaveLength(1);
  });

  it('rejects an element nothing reaches from the root', () => {
    // The other half of the same failure: a chart that was created and bound but
    // never attached, so the page renders without it and the checks say it is
    // fine — because it is, it is just not on the page.
    const spec = {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: {}, children: [] },
        orphan: { type: 'Section', props: { title: 'Never drawn' }, children: [] },
      },
    } as unknown as Parameters<typeof validateReportSpec>[0];

    const issues = validateReportSpec(spec);

    expect(issues).toContainEqual(expect.objectContaining({ elementKey: 'orphan' }));
  });

  it('accepts a spec where every element is reached exactly once', () => {
    const spec = {
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: {}, children: ['a', 'b'] },
        a: { type: 'Section', props: { title: 'A' }, children: [] },
        b: { type: 'Section', props: { title: 'B' }, children: [] },
      },
    } as unknown as Parameters<typeof validateReportSpec>[0];

    expect(validateReportSpec(spec)).toEqual([]);
  });
});
