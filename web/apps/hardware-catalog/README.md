# hardware-catalog

An embedded silicon and board intelligence platform: SoCs, MCUs, modules and boards modelled
as a graph rather than a flat spec table, so the catalog can answer engineering questions
("which boards route out all four MIPI lanes the SoC provides?") instead of only rendering
numbers.

The data model is derived from a survey of the actual market — Raspberry Pi, Radxa, Luckfox,
Milk-V, Arduino, Seeed, Espressif, LattePanda, Jetson, Rockchip, Allwinner, Sophgo, STM32 —
written up in [`docs/20-Hardware-Catalog-Data-Model-Research.md`](../../../docs/20-Hardware-Catalog-Data-Model-Research.md).
Every table traces back to a numbered finding there.

## Deliberately isolated

This app is **not** part of the Helix web stack's runtime. It has:

- **Its own Postgres** (`docker-compose.yml`, port 25433, persistent volume
  `helix-catalog-data`) — separate from the appliance, whose volume is purged by
  `helix appliance up`. Catalog data accumulates and must survive.
- **No dependency on core Helix data.** It never reads a Helix table.
- **No `helix` CLI integration.** Everything runs through `pnpm` scripts here.

It reuses only shared plumbing: `@helix-hq/design-system`, `@helix-hq/web-core` (router-agnostic
tRPC/React scaffolding), `@helix-hq/backend/trpc` (the router factory), and the workspace
eslint/tsconfig presets.

## Running it

```sh
cp .env.example .env
pnpm run db:up          # start Postgres (data persists; `db:down` keeps the volume)
pnpm run db:migrate     # apply migrations
pnpm run dev            # http://localhost:3100
```

`pnpm run db:generate` after changing the schema; `pnpm run db:studio` to browse.

## Authentication

**There is none yet, by design** — the app is fully open for local development. Every
mutation already resolves a `CatalogActor` from context (`src/server/context.ts`), so adding
the OIDC client against core Helix later is a matter of populating that actor and guarding
the mutation procedures, not reshaping the routers.

## No seed data

The catalog ships empty on purpose. Records are entered by humans or research agents through
the write API. `scripts/smoke.py` is a **test harness**, not a seed script: it writes a
structurally complete slice, asserts the properties the model exists to preserve, and deletes
everything again unless `--keep` is passed.

```sh
python3 scripts/smoke.py            # write, assert, clean up
python3 scripts/smoke.py --keep     # leave the rows in place to look at the UI
```

## Shape of the model

```
architecture / core_design  →  silicon  →  silicon_variant (ordering codes)
                                  ↑
                          product_silicon (role + interconnect)
                                  ↓
form_factor / connector_standard  ←  product  →  product_variant (the orderable SKU)
```

The rules the schema enforces, each earned from a real part:

1. Capability is recorded once at the tier that owns it and inherited by composition — a
   module's FCC approval is not copied onto fifty boards.
2. Every capability names the silicon providing it. A Pi 5's USB 3.0 belongs to RP1, not
   BCM2712.
3. Silicon capability and board exposure are separate rows; the delta between them is the
   interesting query.
4. Compatibility and software support are graded enums with evidence, never booleans.
5. Offers and prices attach to `product_variant`, never `product`.
6. Every performance number carries its operating mode, and every accelerator figure its
   precision.
7. Anything a flat column would flatten — codecs, radios, memory tiers, power modes, part
   variants — is a child table.
