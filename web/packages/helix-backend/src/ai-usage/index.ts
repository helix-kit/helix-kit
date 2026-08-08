/**
 * Platform-wide AI metering: what every AI feature costs, per user, and the credit
 * balance that gates it. Not agent-specific — the site assistant, PDF reports, and
 * anything added later all record into the same ledger tagged by `feature`.
 *
 * Integrating a new AI feature is two calls:
 *
 *   const access = await checkAiAccess(db, userId);   // before spending anything
 *   if (!access.allowed) { ...402/403... }
 *
 *   await meterSdkUsage(db, {                          // after the call finishes
 *     userId, feature: 'my-feature', model, gateway, usage: totalUsage,
 *   });
 */
export {
  readAiBalance,
  checkAiAccess,
  recordAiUsage,
  meterSdkUsage,
  fromSdkUsage,
  listUserAiUsage,
  type AiBalance,
  type AiAccess,
  type SdkUsage,
  type RecordUsageInput,
} from './metering';

export {
  loadModelPricing,
  computeCost,
  type ModelPricing,
  type PricedUsage,
  type CostResult,
} from './pricing';

export {
  aiUsageRouter,
  type AiUsageRouter,
  type AiUsageContext,
  type AiUsageSessionUser,
} from './router';

export {
  aiUsageEvent,
  aiUserBudget,
  aiCreditGrant,
  type AiUsageEvent,
  type NewAiUsageEvent,
  type AiUserBudget,
  type AiCreditGrant,
} from '../db/ai-usage-schema';
