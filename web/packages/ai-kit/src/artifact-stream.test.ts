import { describe, expect, it } from 'vitest';

import { createArtifactCollector, type ArtifactEvent } from './artifact-stream';

import type { ArtifactSpec } from './types';

const CODE = 'report.code';
const PATCH_MODE = 'jsonl-patch' as const;
const DELTA = 'artifact-delta' as const;
const VALUE = 'artifact-value' as const;
const LAYOUT = 'report.layout';
const OP_A = '{"op":"a"}';
const OP_B = '{"op":"b"}';

const ARTIFACTS: ArtifactSpec[] = [
  { kind: CODE, description: 'The code step.', mode: 'replace' },
  { kind: LAYOUT, description: 'The layout.', mode: PATCH_MODE },
];

const collect = (events: ArtifactEvent[]) => {
  const values: [string, unknown][] = [];
  const lines: [string, string][] = [];
  const ended: string[] = [];
  const unknown: [string, string][] = [];

  const collector = createArtifactCollector(ARTIFACTS, {
    onValue: (kind, value) => values.push([kind, value]),
    onPatchLine: (kind, line) => lines.push([kind, line]),
    onEnd: (kind) => ended.push(kind),
    onUnknown: (kind, reason) => unknown.push([kind, reason]),
  });

  for (const event of events) {
    collector.handle(event);
  }

  return { values, lines, ended, unknown };
};

const delta = (chunk: string): ArtifactEvent => ({
  type: DELTA,
  kind: LAYOUT,
  chunk,
});

describe('createArtifactCollector', () => {
  it('hands a replace artifact straight through', () => {
    const { values } = collect([{ type: VALUE, kind: CODE, value: 'return {};' }]);

    expect(values).toEqual([[CODE, 'return {};']]);
  });

  it('emits one patch line per newline', () => {
    const { lines } = collect([delta(`${OP_A}\n${OP_B}\n`)]);

    expect(lines.map(([, line]) => line)).toEqual([OP_A, OP_B]);
  });

  it('holds back a line split across two deltas', () => {
    // The failure this guards: transports break wherever they like, and a
    // consumer parsing each chunk alone would see two invalid halves.
    const { lines } = collect([delta('{"op":"a","va'), delta('lue":1}\n')]);

    expect(lines.map(([, line]) => line)).toEqual(['{"op":"a","value":1}']);
  });

  it('does not emit a trailing line until the artifact ends', () => {
    const mid = collect([delta(`${OP_A}\n${OP_B}`)]);
    expect(mid.lines).toHaveLength(1);

    const full = collect([delta(`${OP_A}\n${OP_B}`), { type: 'artifact-end', kind: LAYOUT }]);
    expect(full.lines.map(([, line]) => line)).toEqual([OP_A, OP_B]);
  });

  it('ignores blank lines rather than emitting empty patches', () => {
    const { lines } = collect([delta(`${OP_A}\n\n\n${OP_B}\n`)]);

    expect(lines).toHaveLength(2);
  });

  it('keeps two artifacts buffered independently', () => {
    const collector = createArtifactCollector(
      [
        { kind: 'one', description: '', mode: PATCH_MODE },
        { kind: 'two', description: '', mode: PATCH_MODE },
      ],
      { onPatchLine: (kind, line) => seen.push(`${kind}:${line}`) },
    );
    const seen: string[] = [];

    collector.handle({ type: DELTA, kind: 'one', chunk: 'a-par' });
    collector.handle({ type: DELTA, kind: 'two', chunk: 'b-whole\n' });
    collector.handle({ type: DELTA, kind: 'one', chunk: 't\n' });

    expect(seen).toEqual(['two:b-whole', 'one:a-part']);
  });

  it('reports a kind that is not in the artifact table', () => {
    const { unknown, values } = collect([{ type: VALUE, kind: 'report.invented', value: 1 }]);

    expect(values).toHaveLength(0);
    expect(unknown[0]?.[0]).toBe('report.invented');
  });

  it('reports a whole value sent for a patch artifact', () => {
    const { unknown, values } = collect([{ type: VALUE, kind: LAYOUT, value: {} }]);

    expect(values).toHaveLength(0);
    expect(unknown[0]?.[1]).toMatch(/deltas/);
  });

  it('reports a delta sent for a replace artifact', () => {
    const { unknown, lines } = collect([{ type: DELTA, kind: CODE, chunk: 'x' }]);

    expect(lines).toHaveLength(0);
    expect(unknown[0]?.[1]).toMatch(/whole value/);
  });

  it('starts clean when a kind is streamed twice', () => {
    const { lines } = collect([
      delta('leftover'),
      { type: 'artifact-end', kind: LAYOUT },
      delta('fresh\n'),
    ]);

    expect(lines.map(([, line]) => line)).toEqual(['leftover', 'fresh']);
  });

  it('applies a buffered last line when asked to flush', () => {
    // The failure this prevents: a model that never sets `done` leaves the final
    // operation in the buffer, and the final operation of a patch is usually the
    // one attaching everything before it to the document — so the parts arrive,
    // orphaned, and the page renders without them.
    const lines: string[] = [];
    const collector = createArtifactCollector(ARTIFACTS, {
      onPatchLine: (_kind, line) => lines.push(line),
    });

    collector.handle({ type: DELTA, kind: LAYOUT, chunk: `${OP_A}\n${OP_B}` });
    expect(lines).toEqual([OP_A]);

    collector.flush();

    expect(lines).toEqual([OP_A, OP_B]);
  });

  it('flushes every kind that still holds something', () => {
    const seen: string[] = [];
    const collector = createArtifactCollector(ARTIFACTS, {
      onPatchLine: (kind, line) => seen.push(`${kind}:${line}`),
    });

    collector.handle({ type: DELTA, kind: LAYOUT, chunk: OP_A });
    collector.flush();
    collector.flush();

    // Flushed once, not once per call: a second flush has nothing left to apply.
    expect(seen).toEqual([`${LAYOUT}:${OP_A}`]);
  });
});
