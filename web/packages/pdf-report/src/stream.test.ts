import { describe, expect, it } from 'vitest';

import { applyReportPatchLine } from './stream';
import { validateReportSpec } from './validate';

import type { ReportSpec } from './types';

const EMPTY = {} as ReportSpec;

/** One SpecStream line, as a model emits it. */
const line = (patch: unknown): string => JSON.stringify(patch);

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
    value: { type: 'Page', props: { size: 'A4' }, children: ['title'] },
  },
  {
    op: 'add',
    path: '/elements/title',
    value: { type: 'Heading', props: { text: 'Fleet' }, children: [] },
  },
];

const applyAll = (patches: unknown[]): ReportSpec =>
  patches.reduce<ReportSpec>((spec, patch) => applyReportPatchLine(spec, line(patch)), EMPTY);

describe('applyReportPatchLine', () => {
  it('builds a spec one line at a time', () => {
    const spec = applyAll(GENERATED);

    expect(spec.root).toBe('doc');
    expect(Object.keys(spec.elements)).toEqual(['doc', 'page', 'title']);
  });

  it('produces a spec that validates', () => {
    expect(validateReportSpec(applyAll(GENERATED))).toEqual([]);
  });

  it('returns a new object, so a host can render each step', () => {
    const first = applyReportPatchLine(EMPTY, line(GENERATED[0]));
    const second = applyReportPatchLine(first, line(GENERATED[1]));

    expect(second).not.toBe(first);
  });

  it('edits what earlier lines put there', () => {
    const spec = applyReportPatchLine(
      applyAll(GENERATED),
      line({ op: 'replace', path: '/elements/title/props/text', value: 'Renamed' }),
    );

    const title = spec.elements.title as unknown as { props: { text: string } };
    expect(title.props.text).toBe('Renamed');
  });

  it('ignores a line that is not a patch, since prose shares the channel', () => {
    const spec = applyReportPatchLine(applyAll(GENERATED), 'Here is the layout:');

    expect(spec.root).toBe('doc');
  });

  it('leaves the spec it was given untouched', () => {
    // A patch writes into nested paths, so a shallow copy would reach through
    // into the caller's objects — silently rewriting the template that was used
    // as a starting point, for the rest of the process.
    const base = applyAll(GENERATED);
    const before = JSON.stringify(base);

    applyReportPatchLine(
      base,
      line({ op: 'replace', path: '/elements/title/props/text', value: 'Changed' }),
    );

    expect(JSON.stringify(base)).toBe(before);
  });

  it('does not share nested objects with its result', () => {
    const base = applyAll(GENERATED);
    const next = applyReportPatchLine(
      base,
      line({ op: 'add', path: '/elements/extra', value: {} }),
    );

    expect(next.elements).not.toBe(base.elements);
  });

  it('ignores an empty line', () => {
    expect(applyReportPatchLine(applyAll(GENERATED), '').root).toBe('doc');
  });
});
