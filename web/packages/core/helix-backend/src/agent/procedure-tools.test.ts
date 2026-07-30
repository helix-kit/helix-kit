import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { collectProcedureTools } from './procedure-tools';

import { createTRPCForContext } from '../trpc';

type TestContext = { actor: string };

const t = createTRPCForContext<TestContext>();

const router = t.router({
  users: t.router({
    list: t.procedure
      .meta({ tool: { description: 'List all platform users.' } })
      .query(() => [{ id: 'u1' }, { id: 'u2' }]),
    remove: t.procedure
      .meta({ tool: { destructive: true } })
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => ({ removed: input.id })),
  }),
  reports: t.procedure
    .meta({ openapi: { method: 'GET', path: '/api/reports', summary: 'Fetch a dated report.' } })
    .input(z.object({ since: z.coerce.date() }))
    .query(({ input }) => ({ since: input.since.toISOString() })),
  internalSecret: t.procedure.meta({ tool: { expose: false } }).query(() => 'hidden'),
  ping: t.procedure.query(() => 'pong'),
});

const caller = router.createCaller({ actor: 'tester' });
const tools = collectProcedureTools(router, caller);
const byName = new Map(tools.map((tool) => [tool.name, tool]));

describe('collectProcedureTools', () => {
  it('auto-exposes every procedure except explicit opt-outs', () => {
    expect([...byName.keys()].sort()).toEqual(['ping', 'reports', 'users_list', 'users_remove']);
    expect(byName.has('internalSecret')).toBe(false);
  });

  it('names nested procedures by dotted path with dots replaced', () => {
    expect(byName.get('users_list')?.path).toBe('users.list');
  });

  it('derives descriptions from tool meta, then openapi, then the path', () => {
    expect(byName.get('users_list')?.description).toBe('List all platform users.');
    expect(byName.get('reports')?.description).toBe('Fetch a dated report.');
    expect(byName.get('ping')?.description).toContain('ping');
  });

  it('classifies kind and side-effect hints', () => {
    expect(byName.get('users_list')?.kind).toBe('query');
    expect(byName.get('users_list')?.readOnly).toBe(true);
    const remove = byName.get('users_remove');
    expect(remove?.kind).toBe('mutation');
    expect(remove?.readOnly).toBe(false);
    expect(remove?.destructive).toBe(true);
  });

  it('renders date inputs as ISO date-time strings instead of throwing', () => {
    const schema = byName.get('reports')?.inputJsonSchema as {
      properties?: { since?: { type?: string; format?: string } };
    };
    expect(schema.properties?.since?.type).toBe('string');
    expect(schema.properties?.since?.format).toBe('date-time');
  });

  it('executes queries and mutations through the caller', async () => {
    await expect(byName.get('users_list')?.execute({})).resolves.toEqual([
      { id: 'u1' },
      { id: 'u2' },
    ]);
    await expect(byName.get('users_remove')?.execute({ id: 'u9' })).resolves.toEqual({
      removed: 'u9',
    });
  });

  it('coerces string date input back through the procedure', async () => {
    await expect(
      byName.get('reports')?.execute({ since: '2026-01-02T03:04:05.000Z' }),
    ).resolves.toEqual({ since: '2026-01-02T03:04:05.000Z' });
  });
});
