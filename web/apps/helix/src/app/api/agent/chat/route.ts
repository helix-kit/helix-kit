import { recordUsage, saveConversation } from '@helix/backend/agent';
import {
  convertToModelMessages,
  createIdGenerator,
  gateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';

import { env } from '@/lib/env';
import { buildSystemPrompt } from '@/server/agent/system-prompt';
import { buildAgentTools } from '@/server/agent/tools';
import { db } from '@/server/db';
import { appRouter, createTRPCContext } from '@/server/trpc';

// Cap on agent reasoning/tool steps per turn.
const MAX_STEPS = 16;

const STATUS = {
  badRequest: 400,
  unauthorized: 401,
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
    await caller.agent.getConversation({ id: conversationId });
  } catch {
    return json({ error: 'Conversation not found.' }, STATUS.notFound);
  }

  const startedAt = Date.now();
  const result = streamText({
    model: gateway(env.AGENT_MODEL),
    system: buildSystemPrompt(user),
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools({ db, caller, conversationId, userId: user.id }),
    stopWhen: stepCountIs(MAX_STEPS),
    // Capture first-class usage metrics for this turn. Never let a metrics write
    // break the chat response.
    onFinish: async ({ totalUsage, finishReason, steps }) => {
      try {
        const toolCalls = steps.reduce((count, step) => count + step.toolCalls.length, 0);
        // reasoning/cached token counts are provider-dependent and not on the base type.
        const extra = totalUsage as { reasoningTokens?: number; cachedInputTokens?: number };
        await recordUsage(db, {
          userId: user.id,
          conversationId,
          model: env.AGENT_MODEL,
          inputTokens: totalUsage.inputTokens ?? 0,
          outputTokens: totalUsage.outputTokens ?? 0,
          totalTokens: totalUsage.totalTokens ?? 0,
          reasoningTokens: extra.reasoningTokens ?? null,
          cachedInputTokens: extra.cachedInputTokens ?? null,
          toolCalls,
          steps: steps.length,
          durationMs: Date.now() - startedAt,
          finishReason,
        });
      } catch {
        // Usage metrics are best-effort.
      }
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
