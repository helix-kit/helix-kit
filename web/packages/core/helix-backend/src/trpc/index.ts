import { initTRPC, TRPCError, type AnyRouter } from '@trpc/server';
import superjson from 'superjson';
import { treeifyError, ZodError } from 'zod';

import type { OpenApiMeta } from 'trpc-to-openapi';

/** Create a typed tRPC builder for a specific context. */
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

/** The typed `t` object passed into router factories. */
export type TRPCFor<TContext extends object> = ReturnType<typeof createTRPCForContext<TContext>>;

/** A router factory declares the context it requires. */
export type RouterFactory<TContext extends object, TRouter extends AnyRouter = AnyRouter> = (
  t: TRPCFor<TContext>,
) => TRouter;

/** A router factory with its context erased, for use as a generic bound (`any` is tRPC's own `AnyRouter` escape hatch; the concrete context is recovered per factory via `ContextOfRouterFactory`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouterFactory = RouterFactory<any, AnyRouter>;

/** Helper for defining router factories while preserving inference (curried so context is explicit but the router type is still inferred). */
export const createRouterFactory =
  <TContext extends object>() =>
  <TRouter extends AnyRouter>(
    factory: RouterFactory<TContext, TRouter>,
  ): RouterFactory<TContext, TRouter> =>
    factory;

/** Extract context from a router factory. */
export type ContextOfRouterFactory<TFactory> =
  TFactory extends RouterFactory<infer TContext, AnyRouter> ? TContext : never;

/** Convert a union into an intersection (`A | B | C` -> `A & B & C`). */
export type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

/** Given a record of router factories, infer the combined context. */
export type CombinedRouterContext<TFactories extends Record<string, AnyRouterFactory>> =
  UnionToIntersection<ContextOfRouterFactory<TFactories[keyof TFactories]>>;

/** Build a root router from a map of router factories. */
export const createRootRouter = <TFactories extends Record<string, AnyRouterFactory>>(
  factories: TFactories,
) => {
  // `& object` keeps this assignable to `TContext extends object`; `UnionToIntersection` alone widens to `unknown` when TFactories is empty.
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
