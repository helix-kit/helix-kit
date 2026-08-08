import { gateway, streamText } from 'ai';

import { env } from '@/lib/env';

import type { ReportSpec } from '@helix/pdf-report';

// Streams a model response; nothing here is cacheable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TEMPERATURE = 0.7;

type GenerateRequestBody = {
  prompt?: string;
  /** Present when refining, which puts the model into patch-only mode. */
  currentSpec?: ReportSpec | null;
};

/**
 * Generates a report template from a description.
 *
 * Both halves of the prompt come from the catalog — it describes every component
 * and its props, including the Helix pack — so the model is told the exact
 * vocabulary a template may use rather than a hand-maintained copy of it. The
 * response is the raw model stream (JSONL patches), left unparsed so the caller
 * can apply or inspect it.
 *
 * NOT auth-gated or metered, unlike /api/agent/chat. This is a development
 * surface on the unauthenticated /pdf-reports page; put it behind
 * `checkAiAccess` / `meterSdkUsage` before exposing it anywhere real.
 */
export const POST = async (request: Request) => {
  const { buildReportGenerationPrompt } = await import('@helix/pdf-report');

  const body = (await request.json().catch(() => ({}))) as GenerateRequestBody;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  if (prompt === '') {
    return Response.json({ error: 'A prompt is required' }, { status: 400 });
  }

  const { system, user } = buildReportGenerationPrompt({
    prompt,
    currentSpec: body.currentSpec ?? null,
  });
  // A failed stream — a missing gateway key being the usual one — is reported
  // through `onError` and otherwise leaves an empty 200 that says nothing. Hold
  // it and relay it to the client, since the point of this surface is to see
  // what happened.
  let streamError: string | null = null;

  const result = streamText({
    model: gateway(env.AGENT_MODEL),
    system,
    prompt: user,
    temperature: TEMPERATURE,
    onError: ({ error }) => {
      streamError = error instanceof Error ? error.message : String(error);
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
