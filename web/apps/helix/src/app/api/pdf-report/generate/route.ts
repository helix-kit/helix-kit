import {
  artifactTools,
  composeAssistant,
  createArtifactCollector,
  type ArtifactEvent,
} from '@helix/ai-kit';
import { toToolSet } from '@helix/ai-kit/ai-sdk';
import { fixtureModel, resolveFixtureMode } from '@helix/ai-kit/fixtures';
import { checkAiAccess, meterSdkUsage } from '@helix/backend/ai-usage';
import {
  applyReportPatchLine,
  defaultReportTemplate,
  REPORT_ARTIFACTS,
  type ReportTemplate,
} from '@helix/pdf-report';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  gateway,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
} from 'ai';

import { env } from '@/lib/env';
import { db } from '@/server/db';
import { createTRPCContext } from '@/server/trpc';

// Streams a model response; nothing here is cacheable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The loop writes, checks and fixes, so it needs longer than a single call.
export const maxDuration = 300;

/** Room to write five artifacts, check them, and fix what the checks reject. */
const MAX_STEPS = 24;

/** Which AI surface this usage belongs to, for per-feature spend breakdowns. */
const FEATURE = 'pdf-report';

/** Recorded turns live with the app, not in a temp dir, so they can be committed. */
const FIXTURE_DIR = 'src/app/api/pdf-report/generate/fixtures';

const STATUS = {
  badRequest: 400,
  unauthorized: 401,
  // `402 Payment Required` distinguishes "out of credits" from "not allowed".
  paymentRequired: 402,
  forbidden: 403,
  serviceUnavailable: 503,
} as const;

const INTRO = `You author PDF report templates for the Helix platform.

Work in this order, and do not skip the checks:

1. Write the **input schema** — the data the report will be given.
2. Write **demo input** matching it, realistic enough to show the report working. Several rows, varied values.
3. Write the **output schema** — one field per thing the page displays.
4. Write the **code**, then call \`try_code\` and fix anything it reports.
5. Write the **layout**, then call \`check_report\`. It takes no arguments — it reads everything you have written.

When the layout is a whole new one rather than an edit to the existing one, set \`replaces\` on the first \`write_report_spec\` call. Without it your elements are merged into the previous layout, whose bindings name fields your code no longer returns.

\`check_report\` is the last word. If it fails, fix what it names and call it again. Do not finish on a failing check.

Write each part with its \`write_report_*\` tool as soon as it is settled — they appear in the editor as they arrive. Keep your prose to a sentence or two about what you built; the artifacts carry the work.`;

type GenerateRequestBody = {
  prompt?: string;
  /** Present when refining: the template as it stands. */
  template?: ReportTemplate;
  /** Gateway model id, for comparing models on the same task. */
  model?: string;
};

const json = (body: unknown, status: number): Response => Response.json(body, { status });

/** Totals the per-step usage an aborted run left behind; `totalUsage` needs a finish. */
const sumUsage = (steps: LanguageModelUsage[]): LanguageModelUsage =>
  steps.reduce<LanguageModelUsage>(
    (total, usage) => ({
      ...total,
      inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
      outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
      totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as LanguageModelUsage,
  );

/**
 * Generates or refines a report template.
 *
 * An agent loop rather than one call: the model writes each part, runs it, and
 * fixes what the run rejects, so what reaches the editor has already executed
 * against real input. A single-shot generation cannot do that — it produces
 * plausible code and a plausible layout whose bindings may name fields the code
 * never returns, and nobody finds out until the preview is blank.
 *
 * Everything the model knows comes from the capabilities of the packages
 * involved, so the components, the sandbox contract and the schema subset it is
 * told about are the ones that actually exist.
 *
 * Spending is gated and metered like the assistant: signed in, in credit, and
 * recorded against the platform ledger. `/pdf-reports` is public, so without this
 * the endpoint would let anyone who found the URL spend from the gateway account.
 */
export const POST = async (request: Request) => {
  const { reportCapabilities } = await import('@helix/pdf-report/ai');

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

  const access = await checkAiAccess(db, user.id);
  if (!access.allowed) {
    return json(
      { error: access.message },
      access.reason === 'out_of_credits' ? STATUS.paymentRequired : STATUS.forbidden,
    );
  }

  const model = typeof body.model === 'string' && body.model !== '' ? body.model : env.AGENT_MODEL;
  const startedAt = Date.now();

  // Development only, and only when asked for by name. Working on this editor's
  // UI otherwise means paying for a real generation to look at a layout bug.
  const fixture = resolveFixtureMode({
    record: process.env['HELIX_AI_RECORD'],
    replay: process.env['HELIX_AI_REPLAY'],
    dir: FIXTURE_DIR,
    nodeEnv: process.env.NODE_ENV,
  });

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // The template as written so far. Held here rather than asked of the
      // model, so the checks judge what the editor will actually receive.
      const working: ReportTemplate = { ...(body.template ?? defaultReportTemplate) };
      let { spec } = working;

      const collector = createArtifactCollector(REPORT_ARTIFACTS, {
        onValue: (kind, value) => {
          const [, field] = kind.split('.');
          if (field !== undefined) {
            Object.assign(working, { [field]: value });
          }
        },
        onPatchLine: (_kind, patchLine) => {
          spec = applyReportPatchLine(spec, patchLine);
          working.spec = spec;
        },
        onReset: () => {
          spec = { root: '', elements: {} } as ReportTemplate['spec'];
          working.spec = spec;
        },
      });

      // Artifacts reach the client as their own data parts, so each lands in the
      // pane it belongs to while the turn is still running.
      const emit = (event: ArtifactEvent) => {
        collector.handle(event);
        writer.write({ type: 'data-artifact', data: event, transient: true });
      };

      const assistant = composeAssistant(
        reportCapabilities({ template: body.template, current: () => working }),
        { intro: INTRO },
      );

      const meter = async (input: {
        usage: LanguageModelUsage;
        toolCalls: number;
        steps: number;
        finishReason: string;
      }) => {
        // A replayed turn calls no provider. Metering it would bill the user for
        // tokens nobody spent and make the ledger useless for the comparison it
        // exists to support.
        if (using === 'replay') {
          return;
        }
        await meterSdkUsage(db, {
          userId: user.id,
          feature: FEATURE,
          // Recorded per request rather than from env: comparing models is the
          // point of the override, and a ledger that always named the default
          // would make the comparison unreadable.
          model,
          gateway,
          usage: input.usage,
          toolCalls: input.toolCalls,
          steps: input.steps,
          durationMs: Date.now() - startedAt,
          finishReason: input.finishReason,
        });
      };

      const { model: languageModel, using } = fixtureModel({
        live: () => gateway(model),
        modelId: model,
        prompt,
        fixture,
      });

      // Says so on the page, so a recorded run is never mistaken for a real one.
      if (fixture.mode !== 'live') {
        writer.write({
          type: 'data-fixture',
          data: { using, name: fixture.name },
          transient: true,
        });
      }

      const result = streamText({
        model: languageModel,
        system: assistant.system,
        prompt:
          body.template === undefined
            ? prompt
            : `${prompt}\n\nThe template as it stands:\n\n\`\`\`json\n${JSON.stringify(body.template, null, 2)}\n\`\`\``,
        tools: toToolSet([...assistant.tools, ...artifactTools(assistant.artifacts, emit)]),
        stopWhen: stepCountIs(MAX_STEPS),
        onFinish: async ({ totalUsage, finishReason, steps }) => {
          // Anything still buffered belongs to the template, not to the void.
          collector.flush();
          await meter({
            usage: totalUsage,
            toolCalls: steps.reduce((count, step) => count + step.toolCalls.length, 0),
            steps: steps.length,
            finishReason,
          });
        },
        // A stopped run still spent what it spent. Without this the ledger loses
        // every abandoned generation, which is precisely the expensive kind —
        // the run somebody stopped because it was going nowhere.
        onAbort: async ({ steps }) => {
          await meter({
            usage: sumUsage(steps.map((step) => step.usage)),
            toolCalls: steps.reduce((count, step) => count + step.toolCalls.length, 0),
            steps: steps.length,
            finishReason: 'abort',
          });
        },
      });

      writer.merge(result.toUIMessageStream({ sendStart: false }));
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({ stream });
};
