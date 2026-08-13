# @helix-hq/design-system

The React component library the Helix console is built from: shadcn/Radix
primitives on Tailwind v4, plus the composite pieces an admin surface actually
needs — a sortable, filterable `DataTable`, mutation and delete-confirm dialogs,
a sidebar shell, charts and a map.

```sh
pnpm add @helix-hq/design-system
```

Peers you supply: `react`, `react-dom`, `lucide-react`, `nuqs` (URL state for
the data table) and `react-hook-form` (the form-driven dialogs).

## Using it

Import the stylesheet once, then pull components in one at a time — every
component is its own entry point, so nothing you do not import is bundled.

```tsx
import '@helix-hq/design-system/globals.css';

import { Button } from '@helix-hq/design-system/components/button';
import { DataTable } from '@helix-hq/design-system/components/data-table';
import { cn } from '@helix-hq/design-system/lib/utils';
```

`globals.css` carries the Tailwind v4 theme: the shadcn design tokens
(`--background`, `--foreground`, `--muted-foreground`, `--destructive`, …) in
both a light and a dark palette. Components are written against those tokens, so
overriding them restyles the whole set without touching component code.

## Exports

| Entry | Contents |
| --- | --- |
| `./globals.css` | The Tailwind v4 theme and design tokens. Import once. |
| `./components/*` | One entry per component — `button`, `input`, `dialog`, `select`, `table`, `sidebar`, `chart`, `map`, and ~40 more. |
| `./components/data-table` | The sortable/filterable/paginated table, with `./components/data-table/data-table-toolbar`. |
| `./components/mutation-modal`, `./components/delete-confirm-dialog` | The create/edit and destructive-confirm dialog patterns. |
| `./hooks/use-data-table` | Table state bound to URL query params via nuqs. |
| `./hooks/use-mobile` | The breakpoint hook the sidebar and drawers use. |
| `./lib/utils` | `cn` — `clsx` + `tailwind-merge`. |
| `./postcss.config` | The shared PostCSS config, re-exportable from an app. |

## Why it is published

It is a peer of [`@helix-hq/json-schema`](../json-schema)'s schema editor, and so
reaches [`@helix-hq/pdf-report`](../pdf-report)'s template editor. That peer is
**optional**: rendering a PDF pulls none of this in — only the editor UI does.
