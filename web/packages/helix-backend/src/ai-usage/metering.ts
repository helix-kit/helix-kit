import { randomUUID } from 'node:crypto';

import { desc, eq, sql } from 'drizzle-orm';

import { computeCost, loadModelPricing, type PricedUsage } from './pricing';

import type { DatabaseClient } from '../db';

import { aiCreditGrant, aiUsageEvent, aiUserBudget } from '../db/ai-usage-schema';

/** Money is stored as numeric(12,6); costs are written with matching precision. */
const USD_DECIMALS = 6;

const toNumber = (value: string | number | null | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export type AiBalance = {
  /** No budget row, or `unlimited` — spend is uncapped. */
  unlimited: boolean;
  aiEnabled: boolean;
  grantedUsd: number;
  spentUsd: number;
  remainingUsd: number;
};

/**
 * A user's credit balance across every AI feature.
 *
 * A user with NO budget row is unrestricted — metering only limits people an admin
 * has deliberately configured, so turning it on never locks anyone out.
 */
export const readAiBalance = async (db: DatabaseClient, userId: string): Promise<AiBalance> => {
  const [budget] = await db
    .select({ aiEnabled: aiUserBudget.aiEnabled, unlimited: aiUserBudget.unlimited })
    .from(aiUserBudget)
    .where(eq(aiUserBudget.userId, userId))
    .limit(1);

  const [granted] = await db
    .select({ total: sql<string>`coalesce(sum(${aiCreditGrant.amountUsd}), 0)` })
    .from(aiCreditGrant)
    .where(eq(aiCreditGrant.userId, userId));

  const [spent] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsageEvent.costUsd}), 0)` })
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.userId, userId));

  const grantedUsd = toNumber(granted?.total);
  const spentUsd = toNumber(spent?.total);

  return {
    unlimited: budget === undefined ? true : budget.unlimited,
    aiEnabled: budget === undefined ? true : budget.aiEnabled,
    grantedUsd,
    spentUsd,
    remainingUsd: grantedUsd - spentUsd,
  };
};

export type AiAccess =
  { allowed: true } | { allowed: false; reason: 'disabled' | 'out_of_credits'; message: string };

/**
 * Gate every AI feature checks BEFORE running a request. Credits are per-user and
 * shared across features, so one balance governs the assistant, reports, and
 * anything added later.
 *
 * Enforcement is necessarily pre-flight: a request's cost is only known once it
 * finishes, so a user can overshoot their balance by at most the final request.
 * That is deliberate — the alternative is refusing to answer until the exact cost
 * is known, which is impossible.
 */
export const checkAiAccess = async (db: DatabaseClient, userId: string): Promise<AiAccess> => {
  const balance = await readAiBalance(db, userId);
  if (!balance.aiEnabled) {
    return {
      allowed: false,
      reason: 'disabled',
      message: 'AI features are turned off for your account. Ask an administrator to enable them.',
    };
  }
  if (!balance.unlimited && balance.remainingUsd <= 0) {
    return {
      allowed: false,
      reason: 'out_of_credits',
      message: 'You have used all of your AI credits. Ask an administrator to add more.',
    };
  }
  return { allowed: true };
};

/**
 * The token counts an AI SDK result reports. Accepts the raw `totalUsage` shape —
 * cached and reasoning counts live in the per-kind detail objects, not at the root.
 */
export type SdkUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined } | undefined;
};

/** Normalize an AI SDK usage object into the shape the pricer expects. */
export const fromSdkUsage = (
  usage: SdkUsage | undefined,
): PricedUsage & { totalTokens: number } => ({
  inputTokens: usage?.inputTokens ?? 0,
  outputTokens: usage?.outputTokens ?? 0,
  totalTokens: usage?.totalTokens ?? 0,
  cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
  reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
});

export type RecordUsageInput = {
  userId: string;
  /** Which AI surface ran this: 'assistant', 'pdf-report', … */
  feature: string;
  model: string;
  /** Whatever the feature considers the subject (conversation id, report id, …). */
  referenceId?: string | null;
  usage: Partial<PricedUsage> & { totalTokens?: number };
  toolCalls?: number;
  steps?: number;
  durationMs?: number | null;
  finishReason?: string | null;
  /** Gateway instance used to price the model. */
  gateway: Parameters<typeof loadModelPricing>[0];
};

/**
 * Record one AI request and what it cost.
 *
 * Never throws: metering must not break the feature it measures, so a failure here
 * is swallowed (the request already happened and the user already has the answer).
 * Returns the cost recorded, or null if nothing was written.
 */
export const recordAiUsage = async (
  db: DatabaseClient,
  input: RecordUsageInput,
): Promise<number | null> => {
  try {
    const usage: PricedUsage = {
      inputTokens: input.usage.inputTokens ?? 0,
      outputTokens: input.usage.outputTokens ?? 0,
      cachedInputTokens: input.usage.cachedInputTokens ?? 0,
      reasoningTokens: input.usage.reasoningTokens ?? 0,
    };
    const prices = await loadModelPricing(input.gateway);
    const { costUsd, estimated } = computeCost(input.model, usage, prices);

    await db.insert(aiUsageEvent).values({
      id: randomUUID(),
      userId: input.userId,
      feature: input.feature,
      model: input.model,
      referenceId: input.referenceId ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: input.usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costUsd: costUsd.toFixed(USD_DECIMALS),
      costEstimated: estimated,
      toolCalls: input.toolCalls ?? 0,
      steps: input.steps ?? 1,
      durationMs: input.durationMs ?? null,
      finishReason: input.finishReason ?? null,
    });
    return costUsd;
  } catch {
    return null;
  }
};

/**
 * One-call metering for a feature that just finished an AI SDK call: hand it the
 * raw `totalUsage` and it normalizes, prices, and records. This is the seam every
 * AI feature should use — see `docs` for the two-line integration.
 */
export const meterSdkUsage = async (
  db: DatabaseClient,
  input: Omit<RecordUsageInput, 'usage'> & { usage: SdkUsage | undefined },
): Promise<number | null> => {
  if (input.usage === undefined) {
    return null;
  }
  return recordAiUsage(db, { ...input, usage: fromSdkUsage(input.usage) });
};

/** Most recent requests for one user, for the usage detail views. */
export const listUserAiUsage = async (db: DatabaseClient, userId: string, limit: number) =>
  db
    .select({
      id: aiUsageEvent.id,
      feature: aiUsageEvent.feature,
      model: aiUsageEvent.model,
      inputTokens: aiUsageEvent.inputTokens,
      outputTokens: aiUsageEvent.outputTokens,
      cachedInputTokens: aiUsageEvent.cachedInputTokens,
      reasoningTokens: aiUsageEvent.reasoningTokens,
      totalTokens: aiUsageEvent.totalTokens,
      costUsd: aiUsageEvent.costUsd,
      costEstimated: aiUsageEvent.costEstimated,
      toolCalls: aiUsageEvent.toolCalls,
      durationMs: aiUsageEvent.durationMs,
      createdAt: aiUsageEvent.createdAt,
    })
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.userId, userId))
    .orderBy(desc(aiUsageEvent.createdAt))
    .limit(limit);
