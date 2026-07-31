---
name: nextjs-web-app
description: >-
  How to build UI and backend routers in the Helix Next.js app (web/apps/helix)
  the way this project wants it. Use whenever you add or change a page, route,
  React component, tRPC router/procedure, data table, list/filter/pagination,
  create/edit dialog, delete confirmation, or URL/query-param state in
  web/apps/helix or the @helix/backend / @helix/design-system packages. Covers:
  tRPC router factories, server-side (RSC) data fetching vs client fetching,
  server/client component boundaries, nuqs query params, the design-system
  DataTable, and the MutationModal / DeleteConfirmDialog dialog pattern. Read
  this BEFORE writing web UI so you copy the established patterns instead of
  inventing new ones.
---

# Building the Helix web app (Next.js)

The Helix core app is `web/apps/helix` (Next.js 16 App Router, React 19, Turbopack,
tRPC v11, TanStack Query v5 + Table v8, nuqs v2, Drizzle/Postgres). Backend logic
lives in `@helix/backend` (`web/packages/helix-backend`); shared UI lives in
`@helix/design-system`. Apps are thin; capability lives in the packages.

The **admin blog list** is the in-repo reference that uses every pattern below
end to end — read it first: `src/app/admin/(dashboard)/page.tsx` (server page +
`createLoader`), `posts-table.tsx` (`DataTable` + `useDataTable`), `search-params.ts`
(nuqs parsers), and `blog/router.ts` `list` in `@helix/backend` (server-side
pagination/filter/sort returning `{ rows, pageCount }`). Most other screens in the
app are still placeholders — copy the admin blog list, not them.

## The six rules

1. **Build every tRPC router with the factory** (`createRouterFactory` / `createRootRouter`
   from `@helix/backend/trpc`). Never hand-roll `initTRPC` in a router.
2. **Prefer server-fetched queries over client fetching.** Fetch in the async
   Server Component with `fetchQuery(...)` and pass data down as props. Reach for
   client `useTRPCQuery` only when the data must change without a navigation.
3. **Server-render by default.** A `page.tsx` is an async Server Component with no
   `"use client"`. Push only the interactive bits into small `"use client"` leaf
   files under a route-private `_components/` folder, so the page ships minimal JS.
4. **Use nuqs for all query-param state.** Define parser objects once, parse them on
   the server with `createLoader`, and read them on the client with
   `useQueryState(s)({ shallow: false })`.
5. **Use the design-system `DataTable` for any non-trivial table.** Never compose a
   large table by hand — no bespoke `<table>` with your own pagination/sort/filter.
6. **Use `MutationModal` for create/edit dialogs, `DeleteConfirmDialog` for
   destructive confirmations, and `ResponsiveModal` for everything else.** Never
   hand-roll a `Dialog` + `useState`-per-field form, never fire a `delete`/`remove`
   mutation straight off a button click with no confirmation step, and never reach
   for the raw `Dialog`/`DialogContent` primitives when `ResponsiveModal` covers it.

---

## 1. tRPC routers — always via the factory

The factory lives in `web/packages/helix-backend/src/trpc/index.ts`
(`@helix/backend/trpc`). Each router **declares the minimum context it needs** as a
plain type; `createRootRouter` intersects the contexts of every mounted router.
There is **no global `publicProcedure`/`protectedProcedure`** — public is plain
`t.procedure`, and auth is a context-narrowing middleware built with
`t.procedure.use(...)` inside the factory.

Create a router at `web/packages/helix-backend/src/<feature>/router.ts`:

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';
import { widget } from '../db/schema';
import { createRouterFactory, TRPCError } from '../trpc';

// Declare exactly the context this router consumes. The app fills it in.
export type WidgetSessionUser = Readonly<{ id: string; role: string | null }>;
export type WidgetContext = Readonly<{
  db: DatabaseClient;
  user: WidgetSessionUser | null;
  adminRoles: readonly string[];
}>;

export const widgetRouter = createRouterFactory<WidgetContext>()((t) => {
  // Auth = middleware that narrows the context (ctx.user becomes non-null).
  const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
  const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next({ ctx });
  });

  return t.router({
    // public read
    list: t.procedure
      .input(z.object({ page: z.number().int().min(1).default(1), perPage: z.number().int().min(1).max(100).default(10) }))
      .query(async ({ ctx, input }) => {
        const offset = (input.page - 1) * input.perPage;
        const rows = await ctx.db.select().from(widget).orderBy(desc(widget.createdAt)).limit(input.perPage).offset(offset);
        const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(widget);
        return { rows, pageCount: Math.ceil(count / input.perPage) };
      }),
    // protected mutation
    create: adminProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => ctx.db.insert(widget).values({ name: input.name }).returning()),
  });
});
export type WidgetRouter = typeof widgetRouter;
```

Every procedure gets a Zod `.input(...)`; queries use `.query`, mutations `.mutation`.
Reference implementations to mirror: `blog/router.ts` (public + admin middleware),
`pki/router.ts`, `releases/api-router.ts`, `device-mtls/fileRouter.ts`.

### Mount it in the app

Add the factory to the root router in `web/apps/helix/src/server/trpc.ts` and make
sure `createTRPCContext` returns every field the combined (intersected) context needs:

```ts
export const appRouter = createRootRouter({ blog: blogAdminRouter, widget: widgetRouter });
export type AppRouter = typeof appRouter;

export const createTRPCContext = async ({ headers }: CreateTRPCContextOptions): Promise<AppTRPCContext> => {
  const session = await auth.api.getSession({ headers });
  const user = session?.user ? { id: session.user.id, role: (session.user as { role?: string | null }).role ?? null } : null;
  return { db, adminRoles: ADMIN_ROLES, user };
};
```

The API route handler (`src/app/api/trpc/[trpc]/route.ts`) and OpenAPI wiring already
consume `appRouter`; you don't touch them for a new router.

---

## 2. Server-side data fetching (RSC) — the default

Fetch in the async Server Component and pass plain data down as props. The server
caller runs the router **in-process** (no HTTP round-trip), so it hits the DB directly.

Use `fetchQuery` from `@/server/server`:

```tsx
// src/app/widgets/page.tsx  — Server Component, no "use client"
import { fetchQuery } from '@/server/server';
import WidgetsTable from './_components/widgets-table';

export default async function WidgetsPage() {
  const data = await fetchQuery((trpc) => trpc.widget.list.queryOptions({ page: 1, perPage: 10 }));
  return <WidgetsTable rows={data.rows} pageCount={data.pageCount} />;
}
```

Run independent fetches concurrently with `Promise.all([...])`. `createTRPCContext`
and the query client are React-`cache()`d per request, so repeat calls dedupe.

---

## 3. Client fetching — only when needed

Reach for client queries only when data must update without a navigation
(polling, live device state, optimistic mutations). The **only** supported client
surface is the builder-style hooks in `@/server/react`
(`useTRPCQuery` / `useTRPCMutation`) — there is no classic `api.x.useQuery`.

```tsx
'use client';
import { useTRPCQuery, useTRPCMutation } from '@/server/react';

export function WidgetLive({ initialData }: { initialData: WidgetList }) {
  // Hydration bridge = initialData (NOT HydrationBoundary): seed the server-rendered
  // data so the first client render matches, then let React Query own it.
  const query = useTRPCQuery((api) => ({ ...api.widget.list.queryOptions({ page: 1, perPage: 10 }), initialData }));
  const create = useTRPCMutation((api) => api.widget.create.mutationOptions({ onSuccess: () => query.refetch() }));
  const rows = query.data ?? initialData;
  // ...
}
```

For a mutation that only needs the server data re-read, prefer calling
`router.refresh()` (`next/navigation`) to re-run the Server Component over manual
cache surgery.

> **Provider:** client hooks require `TRPCReactProvider` (from `@/server/react`)
> mounted above them. The **admin section mounts it** in `src/app/admin/layout.tsx` —
> that is the template. The root `src/app/providers.tsx` does *not* (it mounts a
> bespoke `QueryClientProvider` + `NuqsAdapter`), so if you add client tRPC usage
> outside `/admin`, wrap that subtree in `TRPCReactProvider` the same way.

---

## 4. Server vs client component boundaries

- `page.tsx` / `layout.tsx` are **async Server Components** — read `cookies()`,
  `searchParams`, resolve auth, call `fetchQuery`, and render one client leaf with
  data as props.
- Interactive UI (forms, modals, tables, filter bars, anything with hooks/handlers)
  goes into `"use client"` files colocated in a route-private `_components/` folder
  (the leading underscore excludes it from routing).
- Client leaves derive prop types from the router output rather than redeclaring
  shapes:
  ```ts
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@/server/trpc';
  type WidgetRow = inferRouterOutputs<AppRouter>['widget']['list']['rows'][number];
  ```

---

## 5. nuqs for query params

Install parsers once and **share the same objects** between server and client.
Import parsers from `nuqs/server` in shared/param files and in pages; import hooks
(`useQueryState`, `useQueryStates`) from `nuqs` in client components.

```ts
// src/app/widgets/search-params.ts  — shared by server + client
import { parseAsArrayOf, parseAsInteger, parseAsString } from 'nuqs/server';
import { z } from 'zod';

export const widgetSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  name: parseAsString.withDefault(''),
  tags: parseAsArrayOf(parseAsString, ',').withDefault([]),
};

// zod mirror used as the tRPC .input()
export const widgetListInput = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(10),
  name: z.string().default(''),
  tags: z.array(z.string()).default([]),
});
```

Parse on the server in `page.tsx` with `createLoader`, feed straight into the query:

```tsx
import { createLoader, type SearchParams } from 'nuqs/server';
import { fetchQuery } from '@/server/server';
import { widgetSearchParsers } from './search-params';

const loadSearch = createLoader(widgetSearchParsers);

export default async function WidgetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await loadSearch(searchParams);
  const data = await fetchQuery((trpc) => trpc.widget.list.queryOptions(params));
  return <WidgetsTable rows={data.rows} pageCount={data.pageCount} />;
}
```

On the client, edit params with `{ shallow: false }` so nuqs performs a real
navigation and the Server Component re-runs (re-queries):

```tsx
'use client';
import { parseAsString, useQueryStates } from 'nuqs';

const [{ name }, setQuery] = useQueryStates(
  { name: parseAsString.withDefault('') },
  { shallow: false },
);
```

`NuqsAdapter` is already mounted in `src/app/providers.tsx`.

---

## 6. DataTable for non-trivial tables

The design system ships the full server-side table (TanStack Table v8, URL-synced via
nuqs). **Do not build your own.** Public imports:

```ts
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
```

`useDataTable` is built for **server-backed** data: it sets `manualPagination`,
`manualSorting`, `manualFiltering` and syncs `page` / `perPage` / `sort` and one
query key per filterable column to the URL via nuqs. It **requires `pageCount`** from
your server total. Filter UI is declared entirely through column `meta` — no separate
filter wiring.

Full round-trip: **URL → server `createLoader` → tRPC query (with `pageCount`) →
client `useDataTable` → `DataTable` + `DataTableToolbar`.**

```tsx
// _components/widgets-table.tsx
'use client';
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';

export default function WidgetsTable({ rows, pageCount }: { rows: WidgetRow[]; pageCount: number }) {
  const columns = useMemo<ColumnDef<WidgetRow>[]>(() => [
    { id: 'name', accessorKey: 'name', header: 'Name',
      // opt a column into URL-synced filtering + pick the filter control:
      enableColumnFilter: true, meta: { label: 'Name', variant: 'text' } },
    { id: 'status', accessorKey: 'status', header: 'Status',
      enableColumnFilter: true,
      meta: { label: 'Status', variant: 'multiSelect',
              options: [{ label: 'Active', value: 'active' }, { label: 'Off', value: 'off' }] } },
  ], []);

  // shallow:false => a page/sort/filter change re-runs the Server Component (server pagination).
  const { table } = useDataTable({ data: rows, columns, pageCount, shallow: false });

  return (
    <DataTable table={table} getItemValue={(w) => w.id}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
```

The server side must accept `page`/`perPage`/`sort` + the per-column filter keys, apply
them as Drizzle `and(...conditions)` + `.limit().offset()`, and return `{ rows, pageCount }`
(`pageCount = ceil(total / perPage)`). Filter variants available via `meta.variant`:
`text`, `number`, `range`, `date`, `dateRange`, `select`, `multiSelect`, `boolean`;
faceted/select variants need `meta.options`. For selected-row bulk actions pass an
`actionBar` to `DataTable`.

For a small, static, non-paginated table it's fine to use the plain
`@helix/design-system/components/table` primitives — the "never hand-roll" rule is
about large/filtered/paginated data.

---

## 7. `MutationModal` for create/edit dialogs, `DeleteConfirmDialog` for deletes

The design system ships the full dialog+form+mutation stack (ported from fluxery's
`apps/fluxery/src/components/{mutation-modal,dynamic-form,dynamic-form-fields}.tsx`).
**Never hand-roll** a `Dialog`/`DialogContent` wired up to `useState` per field plus a
manual `mutation.mutate(...)` call, and never fire a destructive mutation straight off
a click with no confirmation — both were the exact anti-patterns found (and fixed)
across `devices-table.tsx`, `users-table.tsx`, `device-actions.tsx`, `posts-table.tsx`,
and the post edit page.

### Create/edit dialogs — `MutationModal`

```ts
import { MutationModal } from '@helix/design-system/components/mutation-modal';
```

`MutationModal` wraps `ResponsiveModal` (Dialog on desktop, Drawer on mobile) +
`DynamicForm` (react-hook-form + `zodResolver`, driven by a declarative `fields[]`
array — types: `input`, `number`, `textarea`, `password`, `email`, `tel`, `url`, `date`,
`time`, `datetime`, `checkbox`, `color`, `select`, `radio`, `stringArray`, `file`,
`custom`) + a `mutation` prop. It owns open/close state, the submit handler, the
success/error toast, and closes itself on success:

```tsx
const create = useTRPCMutation((api) => api.devices.create.mutationOptions());

<MutationModal
  defaultValues={{ name: '', description: '' }}
  fields={[
    { name: 'name', label: 'Name', type: 'input', placeholder: 'sensor-hub-01' },
    { name: 'description', label: 'Description', type: 'input', placeholder: 'Optional' },
  ]}
  mutation={create}
  refresh={(result) => {
    onToken({ name: result.name, token: result.accessToken }); // do something with the mutation result
    router.refresh(); // re-run the Server Component so the new row shows up
  }}
  schema={registerDeviceSchema} // a zod object mirroring the router's .input()
  successToast={() => 'Device registered'}
  titleText="Register device"
  trigger={<Button size="sm"><Plus />Register device</Button>}
/>
```

`mutation` is whatever `useTRPCMutation` returns (needs `mutateAsync` + `isPending`).
`successToast`/`refresh` both receive the mutation's resolved result, typed from the
router's return type — no manual result-state plumbing. `customDescription` sets the
dialog description directly (a plain node/string — `MutationModal` wraps it in
`DialogDescription` itself; do **not** pass an already-wrapped `<DialogDescription>`,
that nests `<p>` inside `<p>` and throws a hydration error).

### Delete confirmations — `DeleteConfirmDialog`

```ts
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
```

Every destructive action needs an `AlertDialog` confirmation step — `DeleteConfirmDialog`
is the shared wrapper so that step is never skipped and never hand-copied:

```tsx
<DeleteConfirmDialog
  title={`Delete ${device.name}?`}
  description="This removes the device and its event history. This cannot be undone."
  isPending={remove.isPending}
  trigger={
    <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
      <Trash2 />
      Delete
    </DropdownMenuItem>
  }
  onConfirm={() => remove.mutate({ id: device.id })}
/>
```

`trigger` can be any element `AlertDialogTrigger asChild` accepts (a `Button`, a
`DropdownMenuItem` with `onSelect` prevented so the parent menu doesn't close early).
`onConfirm` fires the mutation directly — `DeleteConfirmDialog` doesn't manage the
mutation itself, so success/error toasts and `router.refresh()` still live in the
`useTRPCMutation(...)` call the same way they do for non-dialog mutations.

### Anything else — `ResponsiveModal` directly

Some dialogs are neither a create/edit form nor a delete confirmation — e.g. a
one-time token reveal opened programmatically from another component's state, with
no trigger element of its own. `MutationModal` and `DeleteConfirmDialog` are both
themselves built on `ResponsiveModal` (Dialog on desktop, Drawer on mobile); for any
other custom dialog content, use `ResponsiveModal` directly rather than reaching for
the raw `Dialog`/`DialogContent` primitives — it's the one shared base every dialog
in the app should render through, so mobile behavior and styling stay consistent:

```ts
import { ResponsiveModal } from '@helix/design-system/components/responsive-modal';
```

```tsx
// No trigger prop — this dialog is opened by setting `open` from elsewhere,
// not by clicking something inside itself. trigger is optional for exactly
// this case (ResponsiveModal skips rendering DialogTrigger/DrawerTrigger).
<ResponsiveModal
  description="Copy it now — this token is shown only once and cannot be retrieved later."
  open={token !== null}
  title={token === null ? undefined : `Access token for ${token.name}`}
  onOpenChange={(open) => { if (!open) onClose(); }}
>
  <div className="flex min-w-0 items-center gap-2">
    <code className="min-w-0 flex-1 truncate ...">{token?.token}</code>
    <Button size="icon" variant="outline" onClick={...}><Copy /></Button>
  </div>
  <DialogFooter>
    <Button onClick={onClose}>Done</Button>
  </DialogFooter>
</ResponsiveModal>
```

Gotcha: `ResponsiveModal`'s content sits in a CSS `grid` (and its children can be
flex rows too) — a wide unbreakable string (a token, an id, a URL) next to a fixed
button will overflow the dialog unless **every** ancestor in that row down to the
`truncate` element has `min-w-0` (grid/flex items default to `min-width: auto`,
which sizes to content and defeats `truncate`). `DialogFooter` (from
`@helix/design-system/components/dialog`) is just a styled `div`, safe to reuse
inside `ResponsiveModal`'s children even though it's usually paired with raw
`Dialog`.

---

## In-repo reference: the admin blog list

The admin blog post list implements this whole skill end to end — copy it:

| File | Shows |
| --- | --- |
| `web/packages/helix-backend/src/blog/router.ts` (`list`) | Server-side paginated/filtered/sorted query returning `{ rows, pageCount }`; `ilike` title filter, `published` facet, sort mapped to allow-listed columns. |
| `web/apps/helix/src/app/admin/(dashboard)/search-params.ts` | nuqs parser object (`page`/`perPage`/`title`/`status`/`sort`) whose keys match the table column ids. |
| `web/apps/helix/src/app/admin/(dashboard)/page.tsx` | Async Server Component: `createLoader(...)` → `fetchQuery(trpc => trpc.blog.list.queryOptions(params))` → props. |
| `web/apps/helix/src/app/admin/(dashboard)/posts-table.tsx` | `"use client"` leaf: `useDataTable({ data, columns, pageCount, shallow: false })` + `DataTable`/`DataTableToolbar`, column `meta` filters, and a `useTRPCMutation` delete wrapped in `DeleteConfirmDialog`. |
| `web/apps/helix/src/app/admin/(dashboard)/devices/devices-table.tsx` | `MutationModal` create dialog (`RegisterDeviceDialog`) + `DeleteConfirmDialog` delete + a programmatically-opened `ResponsiveModal` (`TokenDialog`, no trigger prop) for the one-time token reveal, alongside plain `useTRPCMutation` action-menu items (activate/rotate) that aren't dialogs at all. |
| `web/apps/helix/src/app/admin/layout.tsx` | Mounts `TRPCReactProvider` (so the client mutation works). |

Note: the app must declare `@tanstack/react-table` as a direct dependency to import
`ColumnDef` etc. (it's a transitive dep of the design system otherwise).

## Fuller reference implementations (outside this repo)

If you need a complete, working example, these sibling repos implement the same
stack end-to-end (same design-system lineage). Read them only if the recipes above
are not enough — everything essential is already inlined here.

- `~/code/expense-tracker` — the best server-side `DataTable` + nuqs + filters/pagination
  round-trip (`web/src/hooks/use-data-table.ts`, `web/src/app/(main)/statements/`).
