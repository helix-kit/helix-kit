import { checkAiAccess, meterSdkUsage } from '@helix/backend/ai-usage';
import { gateway, streamText } from 'ai';

import { env } from '@/lib/env';
import { db } from '@/server/db';
import { createTRPCContext } from '@/server/trpc';

import type { ReportSpec } from '@helix/pdf-report';

// Streams a model response; nothing here is cacheable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TEMPERATURE = 0.7;

/** Which AI surface this usage belongs to, for per-feature spend breakdowns. */
const FEATURE = 'pdf-report';

const STATUS = {
  badRequest: 400,
  unauthorized: 401,
  // `402 Payment Required` distinguishes "out of credits" from "not allowed".
  paymentRequired: 402,
  forbidden: 403,
  serviceUnavailable: 503,
} as const;

type GenerateRequestBody = {
  prompt?: string;
  /** Present when refining, which puts the model into patch-only mode. */
  currentSpec?: ReportSpec | null;
};

const json = (body: unknown, status: number): Response => Response.json(body, { status });

/**
 * Generates a report template from a description.
 *
 * Both halves of the prompt come from the catalog — it describes every component
 * and its props, including the Helix pack — so the model is told the exact
 * vocabulary a template may use rather than a hand-maintained copy of it. The
 * response is the raw model stream (JSONL patches), left unparsed so the caller
 * can apply or inspect it.
 *
 * Spending is gated and metered the same way the assistant is: signed in, in
 * credit, and every call recorded against the platform AI ledger. `/pdf-reports`
 * itself is public, so without this the endpoint would let anyone who found the
 * URL spend from the gateway account.
 */
export const POST = async (request: Request) => {
  const { buildReportGenerationPrompt } = await import('@helix/pdf-report');

  const body = (await request.json().catch(() => ({}))) as GenerateRequestBody;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  if (prompt === '') {
    return json({ error: 'A prompt is required' }, STATUS.badRequest);
  }

  // Identity first: an anonymous caller learns nothing about how this is
  // configured, and nothing downstream can touch the gateway account.
  const ctx = await createTRPCContext({ headers: request.headers, setHeader: async () => {} });
  if (ctx.user === null) {
    return json({ error: 'Sign in to generate a template.' }, STATUS.unauthorized);
  }
  const { user } = ctx;

  if (env.AI_GATEWAY_API_KEY == null) {
    return json(
      { error: 'AI gateway is not configured (set AI_GATEWAY_API_KEY).' },
      STATUS.serviceUnavailable,
    );
  }

  // Refuse before spending anything if the user is disabled or out of credits.
  const access = await checkAiAccess(db, user.id);
  if (!access.allowed) {
    return json(
      { error: access.message },
      access.reason === 'out_of_credits' ? STATUS.paymentRequired : STATUS.forbidden,
    );
  }

  const { system, user: userPrompt } = buildReportGenerationPrompt({
    prompt,
    currentSpec: body.currentSpec ?? null,
  });

  // A failed stream — a missing gateway key being the usual one — is reported
  // through `onError` and otherwise leaves an empty 200 that says nothing. Hold
  // it and relay it to the client, since the point of this surface is to see
  // what happened.
  let streamError: string | null = null;
  const startedAt = Date.now();

  const result = streamText({
    model: gateway(env.AGENT_MODEL),
    system,
    prompt: userPrompt,
    temperature: TEMPERATURE,
    onError: ({ error }) => {
      streamError = error instanceof Error ? error.message : String(error);
    },
    // Metering never throws — it must not break a generation already delivered.
    onFinish: async ({ totalUsage, finishReason }) => {
      await meterSdkUsage(db, {
        userId: user.id,
        feature: FEATURE,
        model: env.AGENT_MODEL,
        gateway,
        usage: totalUsage,
        durationMs: Date.now() - startedAt,
        finishReason,
      });
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        streamError ??= error instanceof Error ? error.message : String(error);
      }

      if (streamError !== null) {
        controller.enqueue(encoder.encode(`\n[stream error] ${streamError}\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  });
};
