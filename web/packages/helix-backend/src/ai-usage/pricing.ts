/**
 * Per-model prices for costing AI requests.
 *
 * Cost is computed by us, not reported by the provider: the AI Gateway's own cost
 * endpoints are account-level (they know the Vercel account, not our users), so a
 * request's cost is tokens x the gateway's per-model pricing. Prices are read from
 * the gateway's model catalogue at runtime and cached, so a price change upstream
 * is picked up without a deploy.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const PRICING_TTL_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** USD per single token (the gateway publishes per-token strings, not per million). */
export type ModelPricing = { input: number; output: number; cachedInput: number };

export type PricedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

export type CostResult = {
  costUsd: number;
  /** True when no pricing was found and the cost is a lower bound (0). */
  estimated: boolean;
};

/**
 * Fallback prices (USD per token) for models we call directly. Only consulted when
 * the gateway has no entry; deliberately small — the gateway is the source of truth.
 */
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  'deepseek/deepseek-v4-pro': { input: 0.00000028, output: 0.00000042, cachedInput: 0.000000028 },
};

type GatewayModelsSource = {
  getAvailableModels: () => Promise<{
    models: {
      id: string;
      pricing?: { input: string; output: string; cachedInputTokens?: string } | null;
    }[];
  }>;
};

let cache: { prices: Map<string, ModelPricing>; fetchedAt: number } | null = null;
let inFlight: Promise<Map<string, ModelPricing>> | null = null;

const toNumber = (value: string | number | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The gateway's price list, cached for an hour. Never throws: a gateway outage
 * keeps the last-good prices (or an empty map) rather than failing the request that
 * is only being measured. Concurrent callers share one in-flight fetch.
 */
export const loadModelPricing = async (
  gateway: GatewayModelsSource,
  now: number = Date.now(),
): Promise<Map<string, ModelPricing>> => {
  if (cache !== null && now - cache.fetchedAt < PRICING_TTL_MS) {
    return cache.prices;
  }
  inFlight ??= (async () => {
    try {
      const { models } = await gateway.getAvailableModels();
      const prices = new Map<string, ModelPricing>();
      for (const model of models) {
        if (model.pricing == null) {
          continue;
        }
        prices.set(model.id, {
          input: toNumber(model.pricing.input),
          output: toNumber(model.pricing.output),
          cachedInput: toNumber(model.pricing.cachedInputTokens),
        });
      }
      cache = { prices, fetchedAt: now };
      return prices;
    } catch {
      return cache?.prices ?? new Map<string, ModelPricing>();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

/**
 * Costs one request. Cached input tokens are billed at the cached rate and are NOT
 * double-counted against the normal input rate (the SDK's `inputTokens` is inclusive
 * of cache reads). Reasoning tokens are already part of `outputTokens` for every
 * provider we use, so they are recorded for visibility but not priced again.
 *
 * An unknown model yields cost 0 flagged `estimated` — a floor, never a failure.
 */
export const computeCost = (
  model: string,
  usage: PricedUsage,
  prices: Map<string, ModelPricing>,
): CostResult => {
  const pricing = prices.get(model) ?? FALLBACK_PRICING[model];
  if (pricing === undefined) {
    return { costUsd: 0, estimated: true };
  }
  const uncachedInput = Math.max(usage.inputTokens - usage.cachedInputTokens, 0);
  const costUsd =
    uncachedInput * pricing.input +
    usage.cachedInputTokens * pricing.cachedInput +
    usage.outputTokens * pricing.output;
  return { costUsd, estimated: false };
};
