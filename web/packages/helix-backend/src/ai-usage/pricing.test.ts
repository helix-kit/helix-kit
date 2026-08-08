import { describe, expect, it } from 'vitest';

import { computeCost, type ModelPricing } from './pricing';

const MODEL = 'test/model';
/** Decimal places for float comparisons — costs are sub-cent sums of products. */
const PRECISION = 10;

// Round rates so the expected costs below are exact rather than float-fuzzy.
const INPUT_RATE = 0.000001;
const OUTPUT_RATE = 0.000002;
const CACHED_RATE = 0.0000001;

const PRICES = new Map<string, ModelPricing>([
  [MODEL, { input: INPUT_RATE, output: OUTPUT_RATE, cachedInput: CACHED_RATE }],
]);

const usage = (over: Partial<Parameters<typeof computeCost>[1]> = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('computeCost', () => {
  it('prices input and output at their own rates', () => {
    const inputTokens = 1000;
    const outputTokens = 500;
    const result = computeCost(MODEL, usage({ inputTokens, outputTokens }), PRICES);
    expect(result.costUsd).toBeCloseTo(
      inputTokens * INPUT_RATE + outputTokens * OUTPUT_RATE,
      PRECISION,
    );
    expect(result.estimated).toBe(false);
  });

  it('bills cached input at the cached rate without double-counting it as input', () => {
    // `inputTokens` is inclusive of cache reads: 1000 reported = 800 uncached + 200 cached.
    const inputTokens = 1000;
    const cachedInputTokens = 200;
    const result = computeCost(MODEL, usage({ inputTokens, cachedInputTokens }), PRICES);
    expect(result.costUsd).toBeCloseTo(
      (inputTokens - cachedInputTokens) * INPUT_RATE + cachedInputTokens * CACHED_RATE,
      PRECISION,
    );
  });

  it('never charges negative input when cached exceeds the reported input', () => {
    const cachedInputTokens = 500;
    const result = computeCost(MODEL, usage({ inputTokens: 100, cachedInputTokens }), PRICES);
    // Uncached floors at zero, so only the cached tokens are billed.
    expect(result.costUsd).toBeCloseTo(cachedInputTokens * CACHED_RATE, PRECISION);
  });

  it('does not price reasoning tokens separately (they are already in output)', () => {
    const outputTokens = 500;
    const withReasoning = computeCost(MODEL, usage({ outputTokens, reasoningTokens: 400 }), PRICES);
    const withoutReasoning = computeCost(MODEL, usage({ outputTokens }), PRICES);
    expect(withReasoning.costUsd).toBe(withoutReasoning.costUsd);
  });

  it('returns an estimated zero floor for an unknown model rather than throwing', () => {
    const result = computeCost('unknown/model', usage({ inputTokens: 1000 }), PRICES);
    expect(result).toEqual({ costUsd: 0, estimated: true });
  });

  it('falls back to the built-in price list when the gateway has no entry', () => {
    const result = computeCost(
      'deepseek/deepseek-v4-pro',
      usage({ inputTokens: 1_000_000 }),
      new Map(),
    );
    expect(result.estimated).toBe(false);
    expect(result.costUsd).toBeGreaterThan(0);
  });
});
