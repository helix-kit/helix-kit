import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { fixtureModel, LAST_TURN, resolveFixtureMode } from './fixtures';
import { readRecording, recordingModel, replayModel, type Recording } from './record';

const dir = () => mkdtempSync(join(tmpdir(), 'helix-fixture-'));

const MODEL = 'test/source';
const TEXT_ID = '0';
const START = 'stream-start';
const TEXT_START = 'text-start';
const TEXT_DELTA = 'text-delta';
const TEXT_END = 'text-end';
const FINISH = 'finish';

/** A model that streams a short answer, standing in for a provider. */
const sourceModel = (text: string) =>
  new MockLanguageModelV4({
    modelId: MODEL,
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: START, warnings: [] },
          { type: TEXT_START, id: TEXT_ID },
          { type: TEXT_DELTA, id: TEXT_ID, delta: text },
          { type: TEXT_END, id: TEXT_ID },
          {
            type: FINISH,
            finishReason: 'stop',
            usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
          },
        ] as never[],
        chunkDelayInMs: 0,
      }),
    }),
  });

describe('resolveFixtureMode', () => {
  const base = { dir: '/fixtures', nodeEnv: 'development' };

  it('records when a recording is named', () => {
    expect(resolveFixtureMode({ ...base, record: 'pie-chart' })).toEqual({
      mode: 'record',
      name: 'pie-chart',
      path: '/fixtures/pie-chart.json',
    });
  });

  it('prefers replay when both are named, since replay is the cheap one', () => {
    const resolved = resolveFixtureMode({ ...base, record: 'a', replay: 'b' });

    expect(resolved.mode).toBe('replay');
  });

  it('refuses to arm outside development', () => {
    // Not merely "the variable is usually unset in production": a replay there
    // would serve one user's recorded turn to another.
    expect(resolveFixtureMode({ ...base, replay: 'pie-chart', nodeEnv: 'production' })).toEqual({
      mode: 'live',
    });
  });

  it('records into the rolling slot when a request asks for the real model', () => {
    // Choosing live and choosing to record are the same act: a real turn that
    // was not kept has to be paid for twice.
    expect(resolveFixtureMode({ ...base, requested: 'live' })).toEqual({
      mode: 'record',
      name: LAST_TURN,
      path: `/fixtures/${LAST_TURN}.json`,
    });
  });

  it('replays the rolling slot when a request asks for the recorded turn', () => {
    expect(resolveFixtureMode({ ...base, requested: 'replay' })).toEqual({
      mode: 'replay',
      name: LAST_TURN,
      path: `/fixtures/${LAST_TURN}.json`,
    });
  });

  it('lets a request override the environment, so switching needs no restart', () => {
    const resolved = resolveFixtureMode({ ...base, replay: 'pie-chart', requested: 'live' });

    expect(resolved.mode).toBe('record');
  });

  it('ignores a requested mode outside development', () => {
    // The flag arrives from a browser. A request must not be able to talk the
    // server into reading recorded turns or writing prompts to disk.
    expect(resolveFixtureMode({ ...base, requested: 'replay', nodeEnv: 'production' })).toEqual({
      mode: 'live',
    });
    expect(resolveFixtureMode({ ...base, requested: 'live', nodeEnv: 'production' })).toEqual({
      mode: 'live',
    });
  });

  it('is live when nothing is named', () => {
    expect(resolveFixtureMode(base)).toEqual({ mode: 'live' });
  });

  it('keeps a name from escaping its directory', () => {
    const resolved = resolveFixtureMode({ ...base, record: '../../etc/passwd' });

    expect(resolved).toMatchObject({ path: '/fixtures/------etc-passwd.json' });
  });
});

describe('recording a turn', () => {
  it('writes what went in and every part that came back', async () => {
    const path = join(dir(), 'turn.json');
    const model = recordingModel(sourceModel('hello'), {
      path,
      prompt: 'say hello',
      modelId: MODEL,
    });

    const result = streamText({ model, prompt: 'say hello' });
    await result.text;

    const recorded = readRecording(path);
    expect(recorded.prompt).toBe('say hello');
    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]?.params).toBeDefined();
    // The parts are kept verbatim: a summary would replay a different stream
    // than the one the UI has to handle.
    expect(recorded.calls[0]?.parts).toContainEqual({
      type: TEXT_DELTA,
      id: TEXT_ID,
      delta: 'hello',
    });
  });

  it('records each call of a multi-call turn in order', async () => {
    const path = join(dir(), 'loop.json');
    let call = 0;
    const stepping = new MockLanguageModelV4({
      modelId: MODEL,
      doStream: async () => {
        call += 1;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: START, warnings: [] },
              { type: TEXT_START, id: TEXT_ID },
              { type: TEXT_DELTA, id: TEXT_ID, delta: `call ${String(call)}` },
              { type: TEXT_END, id: TEXT_ID },
              {
                type: FINISH,
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ] as never[],
            chunkDelayInMs: 0,
          }),
        };
      },
    });

    const model = recordingModel(stepping, { path, prompt: 'p', modelId: MODEL });
    await streamText({ model, prompt: 'first' }).text;
    await streamText({ model, prompt: 'second' }).text;

    expect(readRecording(path).calls).toHaveLength(2);
  });
});

describe('replaying a turn', () => {
  const recorded = async (text: string): Promise<{ path: string; recording: Recording }> => {
    const path = join(dir(), 'turn.json');
    const model = recordingModel(sourceModel(text), { path, prompt: text, modelId: MODEL });
    await streamText({ model, prompt: text }).text;
    return { path, recording: readRecording(path) };
  };

  it('produces the same text without calling a provider', async () => {
    const { recording } = await recorded('the recorded answer');

    const replayed = await streamText({
      model: replayModel(recording, { chunkDelayMs: 0 }),
      prompt: 'ignored',
    }).text;

    expect(replayed).toBe('the recorded answer');
  });

  it('keeps the provider parts verbatim, not a summary of them', async () => {
    // What a summary would drop is exactly what the UI has to cope with: the
    // deltas and their boundaries, not the final text.
    const { recording } = await recorded('x');

    expect(recording.calls[0]?.parts.map((part) => (part as { type: string }).type)).toEqual([
      START,
      TEXT_START,
      TEXT_DELTA,
      TEXT_END,
      FINISH,
    ]);
  });

  it('gives the same result every time, which is the point of a fixture', async () => {
    const { recording } = await recorded('deterministic');

    const first = await streamText({
      model: replayModel(recording, { chunkDelayMs: 0 }),
      prompt: 'a',
    }).text;
    const second = await streamText({
      model: replayModel(recording, { chunkDelayMs: 0 }),
      prompt: 'b',
    }).text;

    expect(first).toBe('deterministic');
    expect(second).toBe(first);
  });

  it('fails loudly when the run outlasts the recording', async () => {
    // A loop that goes further than the recording did is a real difference. It
    // must not end in a silent stop that reads as a finished turn.
    const { recording } = await recorded('once');
    const model = replayModel(recording, { chunkDelayMs: 0 });

    await streamText({ model, prompt: 'a' }).text;

    await expect(streamText({ model, prompt: 'b' }).text).rejects.toThrow();
  });
});

describe('fixtureModel', () => {
  it('replays when the fixture exists', async () => {
    const path = join(dir(), 'existing.json');
    const recording: Recording = {
      prompt: 'p',
      model: MODEL,
      recordedAt: '2026-01-01T00:00:00.000Z',
      calls: [
        {
          params: {},
          parts: [
            { type: START, warnings: [] },
            { type: TEXT_START, id: TEXT_ID },
            { type: TEXT_DELTA, id: TEXT_ID, delta: 'from fixture' },
            { type: TEXT_END, id: TEXT_ID },
            {
              type: FINISH,
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
        },
      ],
    };
    writeFileSync(path, JSON.stringify(recording));

    const { model, using } = fixtureModel({
      live: () => {
        throw new Error('the provider must not be called when a fixture exists');
      },
      modelId: MODEL,
      prompt: 'p',
      fixture: { mode: 'replay', name: 'existing', path },
      chunkDelayMs: 0,
    });

    expect(using).toBe('replay');
    expect(await streamText({ model, prompt: 'x' }).text).toBe('from fixture');
  });

  it('records instead when a replay is asked for but nothing was recorded yet', async () => {
    const path = join(dir(), 'missing.json');

    const { model, using } = fixtureModel({
      live: () => sourceModel('fresh'),
      modelId: MODEL,
      prompt: 'p',
      fixture: { mode: 'replay', name: 'missing', path },
    });
    await streamText({ model, prompt: 'x' }).text;

    // The first run of a new name is exactly the one that has to go to the
    // provider; refusing it would mean naming the fixture twice.
    expect(using).toBe('record');
    expect(readRecording(path).calls).toHaveLength(1);
  });

  it('leaves the live model alone when no fixture is armed', () => {
    const live = sourceModel('live');
    const { model, using } = fixtureModel({
      live: () => live,
      modelId: MODEL,
      prompt: 'p',
      fixture: { mode: 'live' },
    });

    expect(using).toBe('live');
    expect(model).toBe(live);
  });
});
