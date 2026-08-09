import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readRecording, recordingModel, replayModel } from './record';

import type { LanguageModel } from 'ai';

type WrappableModel = Exclude<LanguageModel, string>;

export type FixtureMode =
  | { mode: 'live' }
  | { mode: 'record'; name: string; path: string }
  | { mode: 'replay'; name: string; path: string };

export type FixtureEnv = {
  record?: string | undefined;
  replay?: string | undefined;
  /** Where fixtures live. */
  dir: string;
  /** Anything other than `development` refuses to arm. */
  nodeEnv?: string | undefined;
};

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
  const { record, replay, dir, nodeEnv } = env;

  if (nodeEnv !== 'development') {
    return { mode: 'live' };
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
