import { initTRPC, TRPCError, type AnyRouter } from '@trpc/server';
import superjson from 'superjson';
import { treeifyError, ZodError } from 'zod';

import type { OpenApiMeta } from 'trpc-to-openapi';

/**
 * Create a typed tRPC builder for a specific context.
 *
 * Each router package should declare the minimum context it needs,
 * then define its router using this helper type.
 */
export const createTRPCForContext = <TContext extends object>() =>
  initTRPC
    .context<Readonly<TContext>>()
    .meta<OpenApiMeta>()
    .create({
      transformer: superjson,

      errorFormatter: ({ shape, error }) => ({
        ...shape,
        data: {
          ...shape.data,
          zodError: error.cause instanceof ZodError ? treeifyError(error.cause) : null,
        },
      }),
    });

/**
 * The typed `t` object passed into router factories.
 */
export type TRPCFor<TContext extends object> = ReturnType<typeof createTRPCForContext<TContext>>;

/**
 * A router factory declares the context it requires.
 */
export type RouterFactory<TContext extends object, TRouter extends AnyRouter = AnyRouter> = (
  t: TRPCFor<TContext>,
) => TRouter;

/**
 * A router factory with its context erased, for use as a generic bound.
 *
 * The tRPC builder is invariant in its context (it appears both covariantly in
 * `$types.ctx` and contravariantly in `errorFormatter`), so no concrete context
 * is assignable to a shared `object`/`never` bound. `any` is the same escape
 * hatch tRPC uses for `AnyRouter = Router<any>`; the concrete context is still
 * recovered per factory via `ContextOfRouterFactory`, so nothing is widened at
 * a call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouterFactory = RouterFactory<any, AnyRouter>;

/**
 * Helper for defining router factories while preserving inference.
 *
 * Curried so the context is stated explicitly (`createRouterFactory<Ctx>()`)
 * while the concrete router type is inferred from the factory body — TypeScript
 * cannot partially apply type arguments, so a single-call form would force
 * callers to also spell out the (large, generated) router type.
 */
export const createRouterFactory =
  <TContext extends object>() =>
  <TRouter extends AnyRouter>(
    factory: RouterFactory<TContext, TRouter>,
  ): RouterFactory<TContext, TRouter> =>
    factory;

/**
 * Extract context from a router factory.
 */
export type ContextOfRouterFactory<TFactory> =
  TFactory extends RouterFactory<infer TContext, AnyRouter> ? TContext : never;

/**
 * Convert a union into an intersection.
 *
 * Example:
 *   A | B | C -> A & B & C
 */
export type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

/**
 * Given a record of router factories, infer the combined context.
 */
export type CombinedRouterContext<TFactories extends Record<string, AnyRouterFactory>> =
  UnionToIntersection<ContextOfRouterFactory<TFactories[keyof TFactories]>>;

/**
 * Build a root router from a map of router factories.
 */
export const createRootRouter = <TFactories extends Record<string, AnyRouterFactory>>(
  factories: TFactories,
) => {
  // `& object` keeps the inferred intersection assignable to the
  // `TContext extends object` constraint; `UnionToIntersection` alone widens to
  // `unknown` in the empty-factory-map edge case, which TS rejects.
  type RootContext = CombinedRouterContext<TFactories> & object;

  const t = createTRPCForContext<RootContext>();

  const routers = Object.fromEntries(
    Object.entries(factories).map(([key, factory]) => [key, factory(t as never)]),
  ) as {
    [K in keyof TFactories]: ReturnType<TFactories[K]>;
  };

  return { router: t.router(routers), trpc: t };
};

export { TRPCError };
