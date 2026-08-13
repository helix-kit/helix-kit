import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  artifactTools,
  composeAssistant,
  createArtifactCollector,
  type ArtifactEvent,
} from '@helix-hq/ai-kit';
import { toToolSet } from '@helix-hq/ai-kit/ai-sdk';
import { gateway, stepCountIs, streamText } from 'ai';
import { describe, expect, it } from 'vitest';

import { reportCapabilities } from './ai';
import { REPORT_ARTIFACTS } from './artifacts';
import { defaultReportTemplate } from './defaults';
import { prepareReport } from './pipeline';
import { renderReportToBuffer } from './server';
import { applyReportPatchLine } from './stream';

import type { ReportTemplate } from './types';

/**
 * Drives a real model through the whole authoring loop.
 *
 * Skipped unless a gateway key is present, so it never breaks an ordinary run.
 * It exists because the interesting failures here are not in any unit: whether a
 * model follows the order it is given, whether it uses the checks, and whether
 * what it produces actually renders. Only a real call answers those, and running
 * it per model is how one model is compared with another.
 *
 *   AI_GATEWAY_API_KEY=... HELIX_AI_MODEL=deepseek/deepseek-v4-flash-0731 \
 *     pnpm --filter @helix-hq/pdf-report test ai.live
 */

const readEnvFile = (): Record<string, string> => {
  const values: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(import.meta.dirname, '../../../apps/helix/.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      const [, key, raw] = match ?? [];
      if (key !== undefined && raw !== undefined) {
        values[key] = raw.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env is not an error; the key may come from the environment.
  }
  return values;
};

const fileEnv = readEnvFile();
const apiKey = process.env['AI_GATEWAY_API_KEY'] ?? fileEnv['AI_GATEWAY_API_KEY'];
const model =
  process.env['HELIX_AI_MODEL'] ?? fileEnv['AGENT_MODEL'] ?? 'deepseek/deepseek-v4-flash-0731';

const PROMPT =
  'A weekly energy report for solar inverters: total kWh generated, peak output, a bar chart of kWh per site, and a table of each inverter with its site, kWh, peak watts and fault count. Flag inverters that reported faults.';

const MAX_STEPS = 24;
const TIMEOUT_MS = 300_000;

type Run = {
  template: ReportTemplate;
  toolCalls: string[];
  events: string[];
  text: string;
};

const generate = async (): Promise<Run> => {
  const template: ReportTemplate = { ...defaultReportTemplate };
  let { spec } = defaultReportTemplate;
  const toolCalls: string[] = [];

  const collector = createArtifactCollector(REPORT_ARTIFACTS, {
    onValue: (kind, value) => {
      const field = kind.split('.')[1];
      if (field !== undefined) {
        Object.assign(template, { [field]: value });
      }
    },
    onPatchLine: (_kind, line) => {
      spec = applyReportPatchLine(spec, line);
      template.spec = spec;
    },
    onReset: () => {
      spec = { root: '', elements: {} } as ReportTemplate['spec'];
    },
  });

  const events: string[] = [];
  const emit = (event: ArtifactEvent) => {
    events.push(
      event.type === 'artifact-delta' ? `${event.kind}+${event.chunk.length}b` : event.kind,
    );
    collector.handle(event);
  };

  const capabilities = reportCapabilities({ current: () => template });
  const assistant = composeAssistant(capabilities, {
    intro: `You author PDF report templates.

Write the input schema, then demo input matching it, then the output schema, then the code, then the layout — each with its write_report_* tool. Call try_code after writing code, and check_report (no arguments — it reads what you wrote) once the layout is written. Fix whatever a check reports and call it again. Do not finish on a failing check.

The layout here is a whole new one, so set \`replaces\` on the first write_report_spec call.`,
  });

  const result = streamText({
    model: gateway(model),
    system: assistant.system,
    prompt: PROMPT,
    tools: toToolSet([...assistant.tools, ...artifactTools(assistant.artifacts, emit)], {
      onCall: ({ name }) => {
        toolCalls.push(name);
      },
    }),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const text = await result.text;
  return { template, toolCalls, events, text };
};

describe.skipIf(apiKey === undefined || apiKey === '')(`the authoring loop on ${model}`, () => {
  it(
    'produces a template that runs and renders',
    async () => {
      process.env['AI_GATEWAY_API_KEY'] = apiKey;
      const run = await generate();

      /* eslint-disable no-console -- reporting the run is the point of a live harness */
      console.log(`[${model}] tools: ${run.toolCalls.join(' → ')}`);
      console.log(`[${model}] artifacts: ${run.events.join(', ')}`);
      console.log(`[${model}] said: ${run.text.slice(0, 400)}`);
      /* eslint-enable no-console */

      // It wrote every part rather than leaving the defaults in place.
      expect(run.template.code).not.toBe(defaultReportTemplate.code);
      expect(run.template.spec).not.toEqual(defaultReportTemplate.spec);

      // It verified its own work rather than answering blind.
      expect(run.toolCalls).toContain('check_report');

      // And the result survives the pipeline it will be rendered through.
      const prepared = await prepareReport(run.template);
      expect(Object.keys(prepared.data).length).toBeGreaterThan(0);

      const pdf = await renderReportToBuffer(run.template, { branding: { title: 'Energy' } });
      expect(Buffer.from(pdf).toString('latin1').startsWith('%PDF-')).toBe(true);
      expect(pdf.byteLength).toBeGreaterThan(1_000);
    },
    TIMEOUT_MS,
  );
});
