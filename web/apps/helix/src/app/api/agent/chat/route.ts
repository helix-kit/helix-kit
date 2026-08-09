import { composeAssistant } from '@helix/ai-kit';
import { toToolSet } from '@helix/ai-kit/ai-sdk';
import { checkAiAccess, meterSdkUsage } from '@helix/backend/ai-usage';
import { saveConversation } from '@helix/backend/conversations';
import {
  convertToModelMessages,
  createIdGenerator,
  gateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';

import { env } from '@/lib/env';
import { assistantCapabilities } from '@/server/agent/capabilities';
import { buildIntro } from '@/server/agent/system-prompt';
import { db } from '@/server/db';
import { appRouter, createTRPCContext } from '@/server/trpc';

// Cap on agent reasoning/tool steps per turn.
const MAX_STEPS = 16;

/** Which AI surface this usage belongs to, for per-feature spend breakdowns. */
const FEATURE = 'assistant';

const STATUS = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  // `402 Payment Required` distinguishes "out of credits" from "not allowed", so
  // the client can word the two cases differently.
  paymentRequired: 402,
  notFound: 404,
  serviceUnavailable: 503,
} as const;

export const maxDuration = 60;

type ChatRequestBody = {
  id?: string;
  messages?: UIMessage[];
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const POST = async (req: Request): Promise<Response> => {
  if (env.AI_GATEWAY_API_KEY == null) {
    return json(
      { error: 'AI gateway is not configured (set AI_GATEWAY_API_KEY).' },
      STATUS.serviceUnavailable,
    );
  }

  const body = (await req.json()) as ChatRequestBody;
  const conversationId = body.id;
  const messages = body.messages ?? [];
  if (conversationId === undefined) {
    return json({ error: 'Missing conversation id.' }, STATUS.badRequest);
  }

  const ctx = await createTRPCContext({ headers: req.headers, setHeader: async () => {} });
  if (ctx.user === null) {
    return json({ error: 'Sign in to use the assistant.' }, STATUS.unauthorized);
  }
  const { user } = ctx;
  const caller = appRouter.createCaller(ctx);

  // Authorize the thread through the same guard the UI uses (throws if not owned).
  try {
    await caller.conversations.get({ id: conversationId });
  } catch {
    return json({ error: 'Conversation not found.' }, STATUS.notFound);
  }

  // Refuse before spending anything if the user is disabled or out of credits.
  const access = await checkAiAccess(db, user.id);
  if (!access.allowed) {
    return json(
      { error: access.message },
      access.reason === 'out_of_credits' ? STATUS.paymentRequired : STATUS.forbidden,
    );
  }

  // Composed per request: the tool set is bound to this user's caller, so what
  // the assistant can reach is exactly what they can.
  const assistant = composeAssistant(
    assistantCapabilities({ db, caller, conversationId, userId: user.id }),
    { intro: buildIntro(user) },
  );

  const startedAt = Date.now();
  const result = streamText({
    model: gateway(env.AGENT_MODEL),
    system: assistant.system,
    messages: await convertToModelMessages(messages),
    tools: toToolSet(assistant.tools),
    stopWhen: stepCountIs(MAX_STEPS),
    // Meter this turn against the platform-wide AI ledger. `totalUsage` covers
    // every step of the tool loop, not just the last model call, and metering
    // never throws — it must not break the answer the user already received.
    onFinish: async ({ totalUsage, finishReason, steps }) => {
      await meterSdkUsage(db, {
        userId: user.id,
        feature: FEATURE,
        model: env.AGENT_MODEL,
        referenceId: conversationId,
        gateway,
        usage: totalUsage,
        toolCalls: steps.reduce((count, step) => count + step.toolCalls.length, 0),
        steps: steps.length,
        durationMs: Date.now() - startedAt,
        finishReason,
      });
    },
  });

  // Keep streaming to completion even if the client disconnects, so the turn is
  // persisted whole.
  void result.consumeStream();

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    onFinish: async ({ messages: finalMessages }) => {
      await saveConversation(db, conversationId, finalMessages);
    },
    onError: (error) => (error instanceof Error ? error.message : 'Agent error.'),
  });
};
