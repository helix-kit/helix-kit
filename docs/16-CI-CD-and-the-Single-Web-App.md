<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 16 — CI/CD and the Single Web App

Date: 2026-07-15

Two changes that go together: the public site and the product became **one Next.js
app**, and that app now **builds and deploys itself** to the appliance from GitHub
Actions.

## One app

`web/apps/website` is gone. Everything it served now lives in `web/apps/helix`:

| Path | Owner before | Owner now |
| --- | --- | --- |
| `/`, `/product`, `/legal`, `/open-source` | website | **helix** |
| `/blog`, `/blog/[slug]` | website | **helix** |
| `/docs/[[...slug]]`, `/api/search` | website (fumadocs) | **helix** |
| `/admin/**`, `/device/**`, `/auth/**` | helix | helix |
| `/api/{auth,trpc,upload}` | helix | helix |

There were **no route collisions** — the two apps were disjoint in URL space, and
`helix` had no `/` at all (the root 404'd in production). The work was in the files
they *both* had: one `layout.tsx`, one `globals.css`, one `next.config.ts`, one
`env.ts`.

Why it was worth doing: the blog **admin** already lived in `helix` (`/admin/post/[id]`)
while the blog **public view** lived in `website` — one feature split across two
deployments, two origins, two bundles. And the appliance is a *product*: shipping a
customer one zip that serves their marketing site, their docs and their console is
strictly simpler than shipping two.

### What the merge actually required

- **Root layout.** Only one `<html>` may exist. It keeps the website's three
  `next/font/google` loaders — `globals.css` maps `--font-sans` onto
  `--font-geist-sans`, so dropping them silently falls back to Arial everywhere —
  plus helix's `CookiesProvider` + `AppProviders` (QueryClient / nuqs / theme).
- **`next.config.ts`** is `withMDX({ output: 'standalone', … })`. Those compose: the
  MDX is compiled into the app's chunks at build time, so nothing reads
  `content/docs` at runtime and the zip stays self-contained.
- **The public blog router is mounted as an RSC caller, not an HTTP route.** Its
  context is hard-coded `{ user: null, adminRoles: [] }` — that is what guarantees a
  published-posts-only view regardless of who is signed in. Reusing the authenticated
  `appRouter` context for public reads would quietly throw that guarantee away.
- **The origin vars collapsed.** `NEXT_PUBLIC_SITE_URL` (website) and
  `NEXT_PUBLIC_APP_URL` (pointing *at* helix) would now both equal
  `NEXT_PUBLIC_BASE_URL`. The marketing "open the console" CTAs became an internal
  `/admin` link instead of a cross-origin one.

### The bug that only shows up in production

`robots.txt` and `sitemap.xml` are **prerendered**, and they were built from
`NEXT_PUBLIC_*` — which Next inlines at **build** time. The appliance ships **one
bundle to many installs on different domains**, so a baked-in origin means every
appliance advertises somebody else's URL (and, with no value at build time, it
advertised `http://localhost:3000` — which is exactly what shipped on the first
deploy). Both routes are now `force-dynamic` and read `PUBLIC_APP_URL`, a plain
server var the appliance already writes into `site.env`, so each install resolves its
own origin at request time.

## The pipeline

`.github/workflows/build-deploy.yml` — adapted from a proven cloud pipeline, which
ships container images; Helix ships **zip bundles over SSH**, so "package" is a zip,
not a registry push.

```
push to main
  └─ detect (paths-filter: did web/ change?)
      └─ pipeline  [ONE job, ONE runner, ONE pnpm install]
           install → turbo build → zip bundles → scp
                  → START DEPLOY IN BACKGROUND ──────┐
                  → checks (parallel, reuse the      │  ssh: install-bundles →
                    turbo cache the build warmed)    │  restart → healthcheck
                  → wait for the deploy ◄────────────┘
```

**The deploy is not gated on the checks.** It starts first and the checks run
*concurrently with it*, so the wall clock is `max(deploy, checks)` rather than their
sum; a final step reaps the background PID and surfaces its exit code. Checks still
fail the run — they gate quality, not the rollout. (Move the `Checks` step above
`Start deploy` if you want a hard gate; you lose the overlap.)

### Where the speed comes from

1. **The turbo cache, at two levels.** Remote (`TURBO_API`/`TURBO_TEAM`/`TURBO_TOKEN`)
   when configured, and the local `.turbo` dir restored by `actions/cache` otherwise.
2. **Build once; the checks reuse it.** Build and checks share one runner and one
   install, so `lint`/`typecheck` hit the cache the build just warmed instead of
   rebuilding. **This only works if the build and the checks see identical values for
   every var in turbo's `globalEnv` — all 124 of them.** One mismatch changes the
   `^build` hash and the checks rebuild from scratch. That is why the env block is at
   **job** level, not per-step.
3. **Repackage, never rebuild.** `helix appliance bundles --skip-build` only zips: the
   `pnpm install` and the `turbo build` already happened.
4. **Path filters** so a docs-only push still runs the checks but skips build+deploy.
5. **Concurrency groups**, asymmetric on purpose: `cancel-in-progress: false` for the
   deploy (never kill a half-applied rollout) and `true` for PR checks.

### Deploy mechanics

`cloud/deploy/deploy.sh` runs **on the box** and never builds. It installs the staged
zips with the same `install-bundles.sh` the appliance uses at first boot (so the swap
is a symlink flip and a rollback is repointing `current`), restarts `helix-server` and
`helix-app`, and polls `/` until it answers. That healthcheck is only possible
*because* of the merge — before it, `/` 404'd and there was nothing cheap to poll.

**Migrations are not run by the deploy.** `drizzle-kit` is a devDependency and is not
in the standalone bundle, so a schema change still has to be applied out of band
(`pnpm --filter helix db:migrate` over an SSH tunnel) *before* the deploy that needs
it. This is the pre-existing appliance gap, not a new one.

### Repo settings it expects

| Kind | Name | Purpose |
| --- | --- | --- |
| secret | `EC2_HOST`, `EC2_USER`, `EC2_SSH_PRIVATE_KEY` | the deploy target |
| secret | `TURBO_TOKEN` | remote turbo cache (optional) |
| var | `ENABLE_AUTO_DEPLOY` | must be exactly `"true"` — the kill switch |
| var | `PUBLIC_APP_URL` | inlined as `NEXT_PUBLIC_BASE_URL` at build |
| var | `PUBLIC_DEVICE_STREAM_URL` | the device's mTLS data-plane origin |
| var | `TURBO_API`, `TURBO_TEAM` | remote turbo cache (optional) |
| environment | `Production` | keeps the deploy secrets out of PR runs |

### One check is advisory

`unused` (knip + the unused-tRPC-procedure scan) reports ~48 unused exports that
**predate** this pipeline. Gating on it would make every build red on day one, so it
publishes a Check Run but does not fail the pipeline. Clean it up, then move `unused`
from `ADVISORY` into `CHECKS` in `.github/actions/checks/action.yml`.


## Appendix — developing locally against the LIVE appliance

`helix appliance remote --host <ip> --key <pem>` runs the web apps on your machine
against the real box.

It works because the appliance keeps every backing service on **loopback** and its env
addresses them that way: `DATABASE_URL=…@127.0.0.1:5432/helix`. Forward each service to
the *same port number* locally and the appliance's own env is usable verbatim — the
same string means "the box's Postgres" there and "the tunnel to it" here. The command
opens the tunnels (Postgres, OpenFGA, step-ca, Redpanda, both Mosquitto listeners,
helix-server), reads the box's `internal/secrets/site.env`, and writes
`web/apps/helix/.env`.

Four things cannot survive the trip, and the command fixes each:

| | Why | What it does |
| --- | --- | --- |
| `*_PATH` (PKI certs) | they name files **on the box** | copies them into `.helix-remote/certs/` and rewrites the vars |
| origin URLs | they are better-auth's `baseURL`: the Origin/CSRF check, the redirect + verification links, and the cookie's `Secure`/`__Secure-` flags are all derived from it (see below) | pins them to `http://localhost:<port>` |
| `FS_STORAGE_ROOT` | a directory on the box | a local dir — prod uploads 404 locally and vice versa; nothing is corrupted, the DB rows just point at files you don't have |
| `NODE_ENV` | production disables the dev-only trusted origins | `development` |

Everything else — the database, the auth secret, OpenFGA, the event queue, the TURN
secret — is the real thing. **That is the point and the danger: `pnpm dev` writes to
production, and `pnpm db:migrate` would migrate production.** The command says so on
every run.

### Why the origin has to be overridden

Not because cookies are "signed for an origin" — they are signed with
`BETTER_AUTH_SECRET`, which is copied from the box verbatim and is origin-independent.
`BETTER_AUTH_URL` becomes better-auth's `baseURL`, and three things hang off it:

1. **The trusted-origin / CSRF check.** A request whose `Origin` header matches neither
   `baseURL` nor `trustedOrigins` is rejected. (`auth.ts:resolveTrustedOrigins` already
   whitelists `localhost:3000` when `NODE_ENV=development` — which is the *other* reason
   the command sets it.)
2. **Cookie security flags.** `createCookieGetter` derives them from the scheme:
   `baseURL.startsWith("https://")` ⇒ the session cookie is named
   `__Secure-better-auth.session_token` with `secure: true`. Browsers treat
   `http://localhost` as a *secure context* and will store it anyway, so an https origin
   is survivable there — but it breaks outright on a LAN IP such as
   `http://192.168.1.35:3000`, which this app also trusts.
3. **Redirect and callback URLs**, including the links in verification / reset emails —
   they would point back at production.

Two flags exist because both bit during testing:

- `--port-offset N` — the appliance's ports are often already taken locally (a local
  appliance, another project's container). It shifts every *local* port and rewrites the
  generated env to match.
- `--port N` (default 3000) — the dev server's port. If 3000 is busy Next silently falls
  back to 3001, and the `.env`'s auth origin is then wrong, so login fails with no useful
  error. The command refuses to start if the port is taken.
