<!--
SPDX-FileCopyrightText: 2026 Hardik Jain
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Release Engineering for the `@helix-hq` Packages

Date: 2026-08-14

How the npm packages get versioned, changelogged, validated and published. The
first five releases were done by hand; this is what replaced that.

## The shape of it

| Concern | Tool | Entry point |
| --- | --- | --- |
| Semver + changelog | [Changesets](https://github.com/changesets/changesets) | `pnpm changeset` |
| Public API contract | [`@microsoft/api-extractor`](https://api-extractor.com/) | `pnpm api:check` / `pnpm api:update` |
| Packaging correctness | [`publint`](https://publint.dev) + [`@arethetypeswrong/cli`](https://arethetypeswrong.github.io) | `pnpm publint` |
| Publishing | GitHub Actions, `workflow_dispatch` | `gh workflow run release.yml` |

All four run on every push through `.github/actions/checks`, and again as gates
inside the release workflow.

## Recording a change

A change to a published package needs a changeset:

```sh
pnpm changeset
```

It asks which packages changed and whether the bump is major/minor/patch, then
writes a file to `web/.changeset/`. Commit that alongside the change. Releases
consume and delete them.

Judge the bump from the consumer's side, not from how large the diff felt: a
removed export, a changed signature, a new required peer or a behavioural change
somebody could depend on is **major**, however small the edit. When unsure, look
at the API report diff — a removed or changed line is major, a purely added one
is minor.

Only the five published packages need changesets. The rest are either private or
listed in `ignore` in `.changeset/config.json` because they are not published
yet; that list is the single source of truth for "what we release", and both the
API-report and packaging scripts read it rather than keeping their own copy.

## The API contract

`pnpm api:check` extracts the public type surface of **every published entry
point** — 66 of them across the five packages — into
`web/apps/helix/content/docs/api/`, and fails if any differs from what is
committed.

The point is that a breaking change cannot land invisibly. The report is a
normal file in the diff, so removing an export shows up as a removed line during
review, and the semver decision is grounded in the actual surface rather than in
someone's memory of what they touched.

```sh
pnpm api:update   # regenerate after an intentional API change
pnpm api:check    # what CI runs
```

Two implementation notes worth knowing:

- api-extractor bundles its own TypeScript 5.9. That matters here because the
  repo runs `typescript@7`, the native Go compiler, which exposes **no** classic
  compiler API at all — `createProgram`, `SyntaxKind` and `createCompilerHost`
  are all `undefined`. Anything needing the TS API must bring its own copy.
- The gate keys on `apiReportChanged`, not on api-extractor's `succeeded`.
  `succeeded` is false whenever there is any warning, and the warnings here
  (`ae-forgotten-export` and friends) are informational — gating on them would
  make the check fail permanently and mean nothing.

`@helix-hq/design-system/components/map` is the one entry with no report:
api-extractor cannot follow the ambient `GeoJSON` global namespace, and `map.tsx`
is vendored from mapcn upstream, so rewriting it to explicit `geojson` imports
would put a deliberately-synced file out of sync. The script prints what it
skipped rather than letting the omission read as coverage.

## Packaging validation

`pnpm publint` packs each package with `pnpm pack` and runs both validators
against the **tarball** — not the source tree. That distinction is the whole
value: the workspace `exports` resolve to `src` and the published ones to
`dist`, so nothing in normal development ever exercises the path a consumer
takes.

It found two real defects immediately, both of which had already shipped:

**Export conditions were in the wrong order.** Every package declared
`{ "import": …, "types": … }`. Conditions are matched in declaration order, so a
`types` listed after `import` is never reached and TypeScript falls back to
guessing. All 12 packages were affected. `types` now comes first, and
`scripts/sync-package-exports.ts` generates it that way.

**The shipped `.d.ts` did not resolve under `node16`.** `tsc` emits declarations
that keep the source's extensionless relative imports (`from './compose'`), and
ESM resolution requires explicit extensions — so types silently broke for anyone
using `moduleResolution: node16` or `nodenext`. 73 such imports were shipped. It
went unnoticed because Next and Vite both use `bundler` resolution, which
tolerates it, so the example apps worked fine.

The fix was to stop generating declarations with `tsc` and let `tsdown` bundle
them (`dts: true`), which emits extensioned, self-contained declarations. That
also deleted a build step and a `tsconfig.build.json` per package.

Stylesheets and config subpaths (`./globals.css`, `./editor.css`,
`./postcss.config`) are excluded from the type check — they ship no types, so
`attw` reports them as unresolvable, which is noise rather than a finding.

## Releasing

Releases do **not** happen on push. Pushing `main` already deploys the site, and
an npm publish cannot be undone — only deprecated — so releasing is a separate,
deliberate act:

```sh
gh workflow run release.yml                     # release
gh workflow run release.yml -f dry-run=true     # version and validate only
```

The workflow: install → check for pending changesets (stops if none) → build →
lint, typecheck, API contracts, packaging → `changeset version` → rebuild at the
new versions → commit → `changeset publish` → push the commit and tags.

The commit lands **before** the publish, because `changeset publish` tags `HEAD`
— with the bump uncommitted, the tags would point at the previous tree. The push
comes last, so a failed publish leaves `main` untouched and the run can just be
retried.

### Publishing, and why not `changeset publish`

The publish step is `scripts/publish-packages.ts`, not `changeset publish`.

`changeset publish` shells out to **`pnpm publish`** — which it must, because
pnpm is what rewrites the `workspace:^` protocol into real version ranges at
pack time; `npm` does not understand the protocol and would publish it
literally. But `pnpm publish` has no provenance support, so setting
`NPM_CONFIG_PROVENANCE` did nothing and the first automated release shipped with
`attestations: null` on the registry.

The script gets both: `pnpm pack` produces a tarball with the workspace protocol
already resolved, then `npm publish <tarball> --provenance` signs it with a
[sigstore attestation](https://docs.npmjs.com/generating-provenance-statements)
binding it to the commit and workflow run. That is not possible from a laptop.

It also skips any version already on the registry, so a run retried after a
partial failure does not die on the packages that already made it, and it
creates the same `<name>@<version>` tags `changeset publish` used.

### What it needs

- **`NPM_TOKEN`** — a granular access token with read+write on the `@helix-hq`
  scope and "bypass 2FA" enabled. The account enforces 2FA for publishing, so an
  ordinary token gets a 403.

  It lives on the **`Production` environment**, alongside the deploy secrets —
  which is why the release job declares `environment: name: Production`. Without
  that block `secrets.NPM_TOKEN` resolves to an empty string, and npm answers an
  unauthenticated `PUT` with **`E404 Not Found`**, which reads like the package
  does not exist rather than like a missing credential. The workflow now checks
  the token up front and says so plainly.
- **`RELEASE_TOKEN`** — a fine-grained PAT with **Contents: read and write** on
  this repository, also on the `Production` environment, owned by an account
  with the **admin** role.

  `GITHUB_TOKEN` cannot push to `main`: the `main: PR required for non-owners`
  ruleset requires a pull request and bypasses only `RepositoryRole 5` (admin).
  The obvious fix — adding the Actions bot as a bypass actor — is not possible:
  the API rejects it with *"Actor GitHub Actions integration must be part of the
  ruleset source or owner organization"*, because the first-party Actions app is
  not an installable org app. A PAT works because it acts as its owner, and that
  owner is an admin. It will expire eventually, so the workflow checks it up
  front rather than failing at the last step.

  Tags are unaffected either way — the ruleset targets `refs/heads/main`, and
  tag pushes from CI succeed with the plain job token.
- **`id-token: write`** permission, already set in the workflow, for provenance.

## Versioning between our own packages

Internal dependencies are declared `workspace:^`, never `workspace:*`. `pnpm`
publishes `workspace:*` as an **exact** pin, which stranded
`@helix-hq/json-schema@0.1.0` on `@helix-hq/design-system@0.1.0` the moment
design-system went to `0.2.0` — the peer range could no longer be satisfied.
`workspace:^` publishes as a caret range, which is what a family of packages
released together wants. Changesets bumps dependents automatically
(`updateInternalDependencies: "patch"`).
