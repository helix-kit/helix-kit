# Changesets

Every change to a **published** package needs a changeset — a small file saying
which packages it affects, whether the bump is major/minor/patch, and what to
tell an adopter. Those files are what produce the version numbers and the
`CHANGELOG.md` entries at release time.

```sh
pnpm changeset          # record one, interactively
```

Commit the generated file alongside your change. It is deleted when a release
consumes it.

## What needs one

The five published packages: `@helix-hq/ai-kit`, `@helix-hq/code-executor`,
`@helix-hq/design-system`, `@helix-hq/json-schema`, `@helix-hq/pdf-report`.

Everything else is either private (the apps, the shared configs) or listed in
`ignore` in `config.json` because it is not published yet. Those need nothing.

## Which bump

Semver is a promise to people who have already installed the package, so judge
it from **their** side, not from how big the diff felt:

- **patch** — a bug fix or an internal change nobody can observe.
- **minor** — new API. Existing code keeps working untouched.
- **major** — anything that can break existing code: a removed or renamed
  export, a changed signature or return shape, a new required peer dependency,
  a raised minimum version, or a behavioural change someone could be relying on.

If you are unsure between minor and major, look at the API report diff
(`etc/*.api.md`) — if a line was removed or changed rather than added, it is
major.

## Releasing

Releases do not happen on push. Trigger the **Release** workflow
(`gh workflow run release.yml`), which versions, validates, publishes to npm
with provenance, and pushes the version commit and tags. See
`docs/24-Release-Engineering.md`.
