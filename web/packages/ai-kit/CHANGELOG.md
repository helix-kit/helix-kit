# @helix-hq/ai-kit

## 0.1.1

### Patch Changes

- [`03e4e00`](https://github.com/helix-kit/helix-kit/commit/03e4e001a2944f3374d9c2264be9d166495a5753) Thanks [@jainhardik120](https://github.com/jainhardik120)! - Fix type resolution under `node16` / `nodenext`, and correct the export
  condition order.

  The shipped `.d.ts` files used extensionless relative imports (`from './compose'`),
  which ESM resolution rejects — so types silently failed to resolve for anyone
  using `"moduleResolution": "node16"` or `"nodenext"`. Declarations are now
  bundled with extensioned imports. Bundler-based setups (Next, Vite) were
  unaffected and need no changes.

  Export conditions also listed `types` after `import`. Conditions are matched in
  order, so the `types` entry was never reached and TypeScript fell back to
  guessing; `types` now comes first in every subpath.
