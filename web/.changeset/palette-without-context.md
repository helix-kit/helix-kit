---
'@helix-hq/pdf-report': minor
---

Pass the palette to components by closure rather than React context.

0.3.0 published the palette on a React context created at module scope, which is
exactly what makes a package unusable under Next's `react-server` condition —
`createContext` does not exist there, and a consumer's render threw
`(0, n.createContext) is not a function`. The package's own README warns about
this for `@react-pdf/renderer` and `@json-render/react-pdf`; the fix repeated
the mistake. Adding the package to `serverExternalPackages` is not a workaround
either, since the editor needs it bundled for the browser.

`createHelixPdfComponents(palette)` now builds the registry with the palette
bound into the components that use one, and both render entries construct it
from the caller's branding. No context, so nothing to strip.

Also fixes the bar chart axis: rounding an absent minimum gave every
all-positive chart a phantom band below the axis and a `-1` tick, because
`niceAxisMax` floors at 1. The domain calculation is now `signedDomain`, covered
by tests.
