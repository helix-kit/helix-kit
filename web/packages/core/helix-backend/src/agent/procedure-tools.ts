import { z } from 'zod';

import type { HelixMeta, ToolMeta } from '../trpc';
import type { AnyRouter } from '@trpc/server';

export type ProcedureKind = 'query' | 'mutation' | 'subscription';

/**
 * A provider-neutral description of one exposed tRPC procedure as a tool, with no
 * caller bound. The site AI agent binds a per-request caller (`collectProcedureTools`);
 * the MCP server keeps these static and builds a caller per tool call from the
 * request's auth. Both consume the same enumeration/schema logic here.
 */
export type ProcedureDescriptor = {
  /** Model-safe tool name, unique across the router. */
  name: string;
  /** Dotted tRPC path, e.g. `users.list`. */
  path: string;
  kind: ProcedureKind;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  /** Raw zod input schema (for MCP, whose SDK validates with zod). */
  inputSchema: z.ZodType;
  /** JSON Schema for the tool input (for ai-sdk). */
  inputJsonSchema: Record<string, unknown>;
};

/** A descriptor bound to a caller for execution. */
export type ProcedureTool = ProcedureDescriptor & {
  /** Run the procedure through the caller this tool was built with. */
  execute: (input: unknown) => Promise<unknown>;
};

/** The runtime slice of a tRPC procedure we read: input parsers, kind, and meta. */
type ProcedureDef = {
  _def: {
    type?: ProcedureKind;
    inputs?: unknown[];
    meta?: HelixMeta;
  };
};

const EMPTY_INPUT = z.object({});

// tRPC accumulates each `.input()` call; the last schema is the effective input.
// No-input procedures fall back to an empty object so the model gets a valid schema.
const inputSchemaOf = (proc: ProcedureDef): z.ZodType => {
  const inputs = proc._def.inputs ?? [];
  const last = inputs[inputs.length - 1];
  return last !== undefined ? (last as z.ZodType) : EMPTY_INPUT;
};

/**
 * Convert a procedure's zod input to a JSON Schema the model can consume.
 * `z.date()`/`z.coerce.date()` would otherwise throw ("Date cannot be represented
 * in JSON Schema"); they render as ISO date-time strings (procedures using
 * `z.coerce.date()` coerce them back on the way in). Anything else unrepresentable
 * degrades to "any" rather than failing the whole tool set.
 */
const toInputJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    unrepresentable: 'any',
    override: (ctx) => {
      const def = (ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def;
      if (def?.type === 'date') {
        for (const key of Object.keys(ctx.jsonSchema)) {
          delete (ctx.jsonSchema as Record<string, unknown>)[key];
        }
        Object.assign(ctx.jsonSchema, {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 date-time string.',
        });
      }
    },
  }) as Record<string, unknown>;

const sanitizeToolName = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, '_');

// Tool names can't contain dots; the dotted path is the natural unique key.
const toolNameFor = (path: string, tool: ToolMeta | undefined): string =>
  sanitizeToolName(tool?.name ?? path.replace(/\./g, '_'));

const openApiText = (meta: HelixMeta | undefined): string | undefined => {
  const openapi = meta?.openapi as { summary?: string; description?: string } | undefined;
  return openapi?.description ?? openapi?.summary;
};

const descriptionFor = (path: string, meta: HelixMeta | undefined): string =>
  meta?.tool?.description ?? openApiText(meta) ?? `Invoke the \`${path}\` API procedure.`;

// tRPC's caller is a recursive proxy whose every level is function-typed, so
// navigation must step through functions, not just plain objects.
const resolveCallable = (
  caller: unknown,
  path: string,
): ((input: unknown) => Promise<unknown>) | null => {
  let node: unknown = caller;
  for (const key of path.split('.')) {
    if (node === null || (typeof node !== 'object' && typeof node !== 'function')) {
      return null;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'function' ? (node as (input: unknown) => Promise<unknown>) : null;
};

/**
 * Invoke a procedure by dotted path through a tRPC caller, normalizing the result
 * to plain JSON. Every procedure's own authorization runs (the caller carries the
 * request identity), so a forbidden call simply throws.
 */
export const invokeProcedure = async (
  caller: unknown,
  path: string,
  input: unknown,
): Promise<unknown> => {
  const callable = resolveCallable(caller, path);
  if (callable === null) {
    throw new Error(`Procedure ${path} is not callable.`);
  }
  const result = await callable(input);
  // tRPC returns rich JS values (Date, class instances); model/MCP payloads must be
  // plain JSON, so round-trip to normalize.
  return result === undefined ? null : (JSON.parse(JSON.stringify(result)) as unknown);
};

/**
 * Enumerate every exposed procedure on `router` into a caller-free descriptor.
 * Procedures are exposed by default; a procedure opts out with
 * `.meta({ tool: { expose: false } })`.
 */
export const collectProcedureDescriptors = (router: AnyRouter): ProcedureDescriptor[] => {
  const { procedures } = (
    router as unknown as { _def: { procedures: Record<string, ProcedureDef> } }
  )._def;

  const descriptors: ProcedureDescriptor[] = [];
  const seen = new Set<string>();

  for (const [path, proc] of Object.entries(procedures)) {
    const { meta } = proc._def;
    if (meta?.tool?.expose === false) {
      continue;
    }

    const name = toolNameFor(path, meta?.tool);
    if (seen.has(name)) {
      throw new Error(
        `Duplicate agent tool name "${name}" (procedure "${path}"); set a unique meta.tool.name.`,
      );
    }
    seen.add(name);

    const kind: ProcedureKind = proc._def.type ?? 'query';
    const inputSchema = inputSchemaOf(proc);

    descriptors.push({
      name,
      path,
      kind,
      description: descriptionFor(path, meta),
      readOnly: meta?.tool?.readOnly ?? kind === 'query',
      destructive: meta?.tool?.destructive ?? false,
      inputSchema,
      inputJsonSchema: toInputJsonSchema(inputSchema),
    });
  }

  return descriptors;
};

/**
 * Enumerate the exposed procedures and bind each to `caller` for execution — the
 * form the site AI agent consumes (one caller per request). Because `caller` is
 * built from a request context, exposing the whole surface (including mutations) is
 * safe: authz is enforced once, in tRPC.
 */
export const collectProcedureTools = (router: AnyRouter, caller: unknown): ProcedureTool[] =>
  collectProcedureDescriptors(router).map((descriptor) => ({
    ...descriptor,
    execute: (input: unknown) => invokeProcedure(caller, descriptor.path, input),
  }));
