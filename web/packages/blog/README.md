# @helix-hq/blog

A self-contained blog feature: its own database table, tRPC routers, and UI. Blog is not
core Helix capability, so it lives outside `@helix-hq/backend` and outside the app — an
adopter who does not want a blog simply does not install this package, and nothing in the
platform references it.

This package is the reference shape for optional features: **a feature owns its schema, its
routers, and its presentational components; the host app owns routing, branding, and
composition.**

## Wiring it into a host app

**1. Register the tables** so migrations and the relational query API see them:

```ts
// db.ts
import * as blogSchema from '@helix-hq/blog/server/schema';

export const db = createDb({ pool, extraSchema: blogSchema });
```

and add `packages/blog/src/server/schema.ts` to the `schema` list in `drizzle.config.ts`.

**2. Mount the routers** under the keys the package's client components expect
(`BLOG_ADMIN_ROUTER_KEY` / `BLOG_PUBLIC_ROUTER_KEY`):

```ts
import { blogAdminRouter, blogPublicRouter } from '@helix-hq/blog/server';

createRootRouter({ blog: blogAdminRouter, blogPublic: blogPublicRouter, ... });
```

The context must satisfy `BlogContext` (`db`, `user`, `adminRoles`).

**3. Mount `FeatureTRPCProvider`** from `@helix-hq/web-core/trpc/feature` somewhere above the
admin UI. The package never imports the host's `AppRouter`: its client components resolve
their own router out of the root router by mount key, which is what keeps the dependency
one-directional.

**4. Add the route files.** Next.js cannot route into `node_modules`, so the host keeps thin
route files that fetch data, set metadata, and render this package's components:

```tsx
const posts = await fetchQuery((trpc) => trpc.blogPublic.listPublished.queryOptions({ limit: 24 }));
return <PostGrid posts={posts} />;
```

## What the host still owns

Data fetching and `generateMetadata` (server routes), page chrome, the MDX component map for
`PostContent` (`pre`, `Mermaid`, …), the `/api/upload` endpoint the editor posts to, and the
site identity passed to `createBlogSeo({ origin, siteName })`.
