import { describe, expect, it } from 'vitest';

import { defaultReportDocument } from './defaults';
import { createReportStreamCompiler, createReportStreamReader } from './stream';
import { validateReportSpec } from './validate';

import type { ReportSpec } from './types';

/** One SpecStream line per array entry, as a model emits them. */
const jsonl = (lines: unknown[]): string => lines.map((line) => JSON.stringify(line)).join('\n');

const GENERATED = [
  { op: 'add', path: '/root', value: 'doc' },
  { op: 'add', path: '/elements', value: {} },
  {
    op: 'add',
    path: '/elements/doc',
    value: { type: 'Document', props: {}, children: ['page'] },
  },
  {
    op: 'add',
    path: '/elements/page',
    value: { type: 'Page', props: { size: 'A4' }, children: ['tile'] },
  },
  {
    op: 'add',
    path: '/elements/tile',
    value: {
      type: 'MetricCard',
      props: { label: 'Total Faults', data: { $state: '/devices' }, agg: 'sum', path: 'faults' },
      children: [],
    },
  },
];

describe('createReportStreamCompiler', () => {
  it('compiles a patch stream into a spec', () => {
    const compiler = createReportStreamCompiler();
    const { newPatches } = compiler.push(`${jsonl(GENERATED)}\n`);

    expect(newPatches).toHaveLength(GENERATED.length);
    expect(compiler.getResult()).toEqual({
      root: 'doc',
      elements: {
        doc: { type: 'Document', props: {}, children: ['page'] },
        page: { type: 'Page', props: { size: 'A4' }, children: ['tile'] },
        tile: {
          type: 'MetricCard',
          props: {
            label: 'Total Faults',
            data: { $state: '/devices' },
            agg: 'sum',
            path: 'faults',
          },
          children: [],
        },
      },
    });
  });

  it('produces a spec the renderer accepts', () => {
    const compiler = createReportStreamCompiler();
    compiler.push(`${jsonl(GENERATED)}\n`);

    expect(validateReportSpec(compiler.getResult())).toEqual([]);
  });

  it('builds up progressively, so a partial stream is still a usable spec', () => {
    const compiler = createReportStreamCompiler();
    const seen: number[] = [];

    // Split mid-line to mimic chunk boundaries falling anywhere.
    const text = `${jsonl(GENERATED)}\n`;
    const size = 17;
    for (let index = 0; index < text.length; index += size) {
      const { newPatches } = compiler.push(text.slice(index, index + size));
      if (newPatches.length > 0) {
        seen.push(newPatches.length);
      }
    }

    expect(seen.reduce((total, count) => total + count, 0)).toBe(GENERATED.length);
    expect(compiler.getResult().root).toBe('doc');
  });

  it('refines a seeded spec rather than starting empty', () => {
    const compiler = createReportStreamCompiler(defaultReportDocument.spec);

    compiler.push(
      `${jsonl([{ op: 'replace', path: '/elements/title/props/level', value: 'h2' }])}\n`,
    );

    const result = compiler.getResult();
    // The patch landed…
    const title = result.elements.title as unknown as { props: { level: string } };
    expect(title.props.level).toBe('h2');
    // …and the rest of the seeded template survived.
    expect(Object.keys(result.elements)).toEqual(
      Object.keys(defaultReportDocument.spec.elements as Record<string, unknown>),
    );
  });

  it('leaves the seed untouched', () => {
    const before = JSON.stringify(defaultReportDocument.spec);
    const compiler = createReportStreamCompiler(defaultReportDocument.spec);

    compiler.push(`${jsonl([{ op: 'replace', path: '/root', value: 'other' }])}\n`);

    expect(JSON.stringify(defaultReportDocument.spec)).toBe(before);
  });

  it('silently drops prose, which is why the reader exists', () => {
    const compiler = createReportStreamCompiler();
    const { newPatches } = compiler.push('[stream error] Unauthenticated request to AI Gateway.\n');

    expect(newPatches).toHaveLength(0);
    expect(compiler.getResult() as ReportSpec | Record<string, never>).toEqual({});
  });
});

describe('createReportStreamReader', () => {
  it('separates patches from prose in one stream', () => {
    const stream = createReportStreamReader();

    stream.push('Here is the report you asked for.\n');
    stream.push(`${jsonl(GENERATED)}\n`);
    stream.push('Let me know if you want a chart.\n');
    stream.flush();

    expect(stream.patchCount()).toBe(GENERATED.length);
    expect(stream.spec().root).toBe('doc');
    expect(stream.text()).toBe(
      'Here is the report you asked for.\nLet me know if you want a chart.',
    );
  });

  it('keeps a relayed error, which the compiler would have thrown away', () => {
    const stream = createReportStreamReader();

    stream.push('[stream error] Unauthenticated request to AI Gateway.\n');
    stream.flush();

    expect(stream.patchCount()).toBe(0);
    expect(stream.text()).toContain('Unauthenticated request to AI Gateway');
  });

  it('reads patches out of a ```spec fence', () => {
    const stream = createReportStreamReader();

    stream.push('Sure.\n```spec\n');
    stream.push(`${jsonl(GENERATED)}\n`);
    stream.push('```\n');
    stream.flush();

    expect(stream.patchCount()).toBe(GENERATED.length);
    expect(stream.text()).toBe('Sure.');
  });

  it('survives chunk boundaries falling mid-line', () => {
    const stream = createReportStreamReader();
    const text = `${jsonl(GENERATED)}\n`;

    for (let index = 0; index < text.length; index += 13) {
      stream.push(text.slice(index, index + 13));
    }
    stream.flush();

    expect(stream.patchCount()).toBe(GENERATED.length);
    expect(validateReportSpec(stream.spec())).toEqual([]);
  });

  it('refines a seeded spec without mutating the seed', () => {
    const before = JSON.stringify(defaultReportDocument.spec);
    const stream = createReportStreamReader(defaultReportDocument.spec);

    stream.push(`${jsonl([{ op: 'replace', path: '/root', value: 'other' }])}\n`);
    stream.flush();

    expect(stream.spec().root).toBe('other');
    expect(JSON.stringify(defaultReportDocument.spec)).toBe(before);
  });
});
