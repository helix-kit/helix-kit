# Floor minimization — how small can the edge-UI bundle get?

Sub-experiment of [buildtime-page-gating](../README.md). The parent lab showed
gating removes *marginal* feature weight but leaves a fixed **framework floor**:
a Next.js App Router static export ships ~758 KB raw / ~102 KB gzip of React +
Next runtime before any feature code. This lab attacks that floor.

**Goal: minimize the final bundle as much as possible**, while keeping the exact
same feature components and the same build-time gating.

## Two levers, stacked

1. **Drop Next.js App Router → a static Vite SPA.** The floor *is* Next's App
   Router + its React build. The edge UI is a client-only app talking to a local
   device API — it uses none of Next's server value (RSC, SSR, server data
   fetching, middleware). So a client-routed SPA loses nothing here. The device
   serving model already fits: the prior system's `cloud-comm` serves `index.html` as an
   SPA fallback (`handleUI`), which is exactly what a single-`index.html` SPA
   needs. Routing becomes a ~25-line zero-dep hash router (`src/app.tsx`).
2. **Swap the React runtime → Preact/compat.** `HELIX_RUNTIME=preact` aliases
   `react`/`react-dom` to `preact/compat` (~4 KB gzip) instead of React +
   react-dom (~45 KB gzip). `HELIX_RUNTIME=react` keeps real React for comparison.

Same gating as the parent: `gate.mjs` codegens `src/generated/routes.ts` importing
**only enabled** features; Rollup tree-shakes the rest and their deps.

**No source duplication:** the feature components are the parent lab's files,
reused verbatim through the `@features` → `../app/src/features` Vite alias.

## Results (measured `vite build`, single first-load bundle)

`node measure.mjs` — raw + gzip of all emitted JS (an SPA loads one bundle, so
gzip JS ≈ everything the browser downloads to run the app):

| runtime | profile | raw JS | gzip JS | xyflow | recharts | grid |
| --- | --- | --- | --- | --- | --- | --- |
| react | full | 814.5 KB | 240.6 KB | IN | IN | IN |
| react | minimal | 184.3 KB | 58.1 KB | — | — | — |
| react | workflow-only | 361.3 KB | 115.6 KB | IN | — | — |
| react | charts-only | 570.8 KB | 164.6 KB | — | IN | — |
| react | no-workflow | 647.4 KB | 187.0 KB | — | IN | IN |
| preact | full | 651.2 KB | 191.0 KB | IN | IN | IN |
| **preact** | **minimal** | **20.9 KB** | **8.4 KB** | — | — | — |
| preact | workflow-only | 201.3 KB | 67.0 KB | IN | — | — |
| preact | charts-only | 409.7 KB | 115.3 KB | — | IN | — |
| preact | no-workflow | 486.4 KB | 137.8 KB | — | IN | IN |

## The floor, three ways (minimal profile — 2 light features)

| stack | raw | gzip | vs Next |
| --- | --- | --- | --- |
| Next.js App Router (parent lab) | ~767 KB | ~102 KB first-load | — |
| Vite SPA + React | 184 KB | 58 KB | −43% |
| **Vite SPA + Preact** | **21 KB** | **8.4 KB** | **−92%** |

Leaving Next roughly halves the floor; the Preact swap on top takes an 8.4 KB
gzip floor — **~12× smaller than Next**. The two levers are independent and stack.

Gating still works identically: the dep columns track the enabled set exactly, and
the Preact rows are strictly smaller than their React twins at every profile
(e.g. `full` 191 KB vs 241 KB gzip — the ~50 KB gzip runtime saving survives even
when heavy deps dominate).

## Runtime compatibility — verified, not assumed

The risk with Preact/compat is that heavy React libs compile but break at runtime.
Checked the `preact full` build in a real browser (Playwright):

- **`@xyflow/react`** (`/#/workflows`) — full editor renders: nodes
  (Trigger/Transform/Sink), edges, zoom/fit controls, attribution. Works.
- **`recharts`** (`/#/charts`) — line chart with axes/ticks renders. Works.
- **`react-grid-layout`** (`/#/dashboard`) — builds and renders.
- Only console error across the app is a missing `favicon.ico` (404) — benign.

So all three heavy device-console-class deps run under Preact/compat unmodified.

## Reproduce

```sh
npm install
node gate.mjs --profile minimal --runtime preact --build   # one build → dist/
node measure.mjs                                            # full runtime×profile matrix
# serve any build (SPA, index.html fallback):
cd dist && python3 -m http.server 8080
```

## Tradeoffs of leaving Next

- **Lost, but unused here:** RSC / SSR / server data fetching / middleware /
  image optimization / file-system routing. The edge UI is client-only against a
  local device API, so none of this applies. (If a device UI *did* need
  server-rendered pages, this lever wouldn't fit — but the prior edge UI is a
  static export precisely because it doesn't.)
- **Replaced:** Next's file router → manifest-driven route codegen + a tiny hash
  router. This is *more* aligned with Helix's goals — the enabled feature set is
  already the source of truth (same as the parent lab), and there's no framework
  router runtime to ship.
- **Preact caveat:** `preact/compat` covers the vast majority of React APIs but
  isn't 100% (some ecosystem libs poke at React internals). Every dep must be
  smoke-tested as above. For the three heavy libs that matter here, all pass.

## Recommendation

For a **client-only static edge UI** whose size matters (bundled into a device
image, served by `cloud-comm`), the maximal-shrink stack is **Vite SPA +
Preact/compat + the parent lab's manifest-driven gating**. That combines all
three savings: framework floor (Next→Vite→Preact), runtime (React→Preact), and
per-device feature/dep gating — taking a fully-loaded 50-feature-class bundle
down to an 8 KB-gzip floor plus only the enabled features' weight.

If the edge UI must stay on Next (e.g. to share code/routing conventions with the
cloud console), the parent lab's **filesystem gating alone** is still the right
call — it just can't touch the ~102 KB Next floor.
