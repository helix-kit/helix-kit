import { describe, expect, it } from 'vitest';

import { artifactTools } from './artifact-tools';

import type { ArtifactEvent } from './artifact-stream';
import type { ArtifactSpec } from './types';

const LAYOUT = 'report.spec';
const CODE = 'report.code';
const WRITE_LAYOUT = 'write_report_spec';
const DELTA = 'artifact-delta';
const ADD = '{"op":"add"}';

const SPEC: ArtifactSpec[] = [
  { kind: LAYOUT, description: 'The layout.', mode: 'jsonl-patch' },
  { kind: CODE, description: 'The code.', mode: 'replace' },
];

const collect = () => {
  const events: ArtifactEvent[] = [];
  const tools = artifactTools(SPEC, (event) => events.push(event));
  const byName = (name: string) => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined) {
      throw new Error(`No tool named ${name}.`);
    }
    return tool;
  };
  return { events, byName };
};

const deltaChunk = (events: ArtifactEvent[]): string => {
  const delta = events.find((event) => event.type === DELTA);
  if (delta?.type !== DELTA) {
    throw new Error('No delta was emitted.');
  }
  return delta.chunk;
};

describe('artifactTools', () => {
  it('names a tool after the artifact it writes', () => {
    const { byName } = collect();

    expect(byName(WRITE_LAYOUT).name).toBe(WRITE_LAYOUT);
    expect(byName('write_report_code').name).toBe('write_report_code');
  });

  it('terminates a patch, so its last operation is not left buffered', async () => {
    // The bug this closes: a model sent three operations in one call and set no
    // `done`. The third — the one attaching the new section to the page — sat in
    // the collector's buffer waiting for a newline that never came. The two
    // elements it referenced were created, orphaned, and the page rendered
    // without them, while every check passed, because a document with
    // unreachable elements is perfectly valid and renders perfectly well.
    const { events, byName } = collect();

    await byName(WRITE_LAYOUT).execute({
      patch: '{"op":"add","path":"/a"}\n{"op":"add","path":"/b"}',
    });

    expect(deltaChunk(events).endsWith('\n')).toBe(true);
  });

  it('leaves a newline the model already sent alone', async () => {
    const { events, byName } = collect();

    await byName(WRITE_LAYOUT).execute({ patch: `${ADD}\n` });

    expect(deltaChunk(events)).toBe(`${ADD}\n`);
  });

  it('ends the artifact when the model says it is done', async () => {
    const { events, byName } = collect();

    await byName(WRITE_LAYOUT).execute({ patch: ADD, done: true });

    expect(events.map((event) => event.type)).toEqual([DELTA, 'artifact-end']);
  });

  it('resets before the patch when the layout replaces the previous one', async () => {
    const { events, byName } = collect();

    await byName(WRITE_LAYOUT).execute({ patch: ADD, replaces: true });

    // Order matters: a reset after the patch would discard what it just applied.
    expect(events.map((event) => event.type)).toEqual(['artifact-reset', DELTA]);
  });

  it('sends a replace artifact as a whole value', async () => {
    const { events, byName } = collect();

    await byName('write_report_code').execute({ value: 'return {};' });

    expect(events).toEqual([
      { type: 'artifact-value', kind: CODE, value: 'return {};' },
      { type: 'artifact-end', kind: CODE },
    ]);
  });
});
