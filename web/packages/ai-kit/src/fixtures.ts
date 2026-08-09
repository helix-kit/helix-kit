import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readRecording, recordingModel, replayModel } from './record';

import type { LanguageModel } from 'ai';

type WrappableModel = Exclude<LanguageModel, string>;

export type FixtureMode =
  | { mode: 'live' }
  | { mode: 'record'; name: string; path: string }
  | { mode: 'replay'; name: string; path: string };

/**
 * What the caller asked for this turn, when the choice is made per request.
 *
 * `live` records over the slot as it goes, so the newest real turn is always the
 * one a later replay gets. Choosing live and choosing to record are the same
 * act: a real turn that was not kept is a real turn that has to be paid for
 * twice.
 */
export type FixtureChoice = 'live' | 'replay';

export type FixtureEnv = {
  record?: string | undefined;
  replay?: string | undefined;
  /** Chosen per request, which beats the environment. */
  requested?: FixtureChoice | undefined;
  /** The slot a per-request choice reads and writes. */
  slot?: string;
  /** Where fixtures live. */
  dir: string;
  /** Anything other than `development` refuses to arm. */
  nodeEnv?: string | undefined;
};

/** The rolling slot behind the per-request choice: last real turn wins. */
export const LAST_TURN = 'last-turn';

const fixturePath = (dir: string, name: string): string =>
  join(dir, `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`);

/**
 * Decides whether this request records, replays, or calls the provider.
 *
 * Refuses to arm outside development rather than trusting the environment
 * variable to be absent: a replay reaching production would serve one user's
 * recorded turn to another, and a recording there would write their prompt to
 * disk. Neither should depend on nobody having set a stray variable.
 */
export const resolveFixtureMode = (env: FixtureEnv): FixtureMode => {
  const { record, replay, requested, slot = LAST_TURN, dir, nodeEnv } = env;

  if (nodeEnv !== 'development') {
    return { mode: 'live' };
  }

  // A request can say which it wants, so switching does not mean restarting the
  // server. It is still refused above unless this is a development build: the
  // flag arrives from the browser, and a request must not be able to talk the
  // server into reading recorded turns or writing prompts to disk.
  if (requested === 'replay') {
    return { mode: 'replay', name: slot, path: fixturePath(dir, slot) };
  }
  if (requested === 'live') {
    return { mode: 'record', name: slot, path: fixturePath(dir, slot) };
  }

  if (replay !== undefined && replay !== '') {
    return { mode: 'replay', name: replay, path: fixturePath(dir, replay) };
  }
  if (record !== undefined && record !== '') {
    return { mode: 'record', name: record, path: fixturePath(dir, record) };
  }
  return { mode: 'live' };
};

export type FixtureModelOptions = {
  /** The provider-backed model, built only when it will actually be called. */
  live: () => WrappableModel;
  modelId: string;
  prompt: string;
  fixture: FixtureMode;
  chunkDelayMs?: number | undefined;
};

/**
 * The model this request should use, given the fixture mode.
 *
 * A replay whose fixture is missing falls through to the live model rather than
 * failing: the first run of a new fixture name is exactly the run that has to go
 * to the provider, and refusing it would mean naming the fixture twice.
 */
export const fixtureModel = (
  options: FixtureModelOptions,
): { model: WrappableModel; using: FixtureMode['mode'] } => {
  const { live, modelId, prompt, fixture, chunkDelayMs } = options;

  if (fixture.mode === 'replay' && existsSync(fixture.path)) {
    return {
      model: replayModel(readRecording(fixture.path), { chunkDelayMs }),
      using: 'replay',
    };
  }

  if (fixture.mode === 'record' || fixture.mode === 'replay') {
    return {
      model: recordingModel(live(), { path: fixture.path, prompt, modelId }),
      using: 'record',
    };
  }

  return { model: live(), using: 'live' };
};
