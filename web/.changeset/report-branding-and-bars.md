---
'@helix-hq/pdf-report': minor
---

Branding and the chart palette now come from the caller.

Every report was a Helix document whoever rendered it: the header read `HELIX`
beside the Helix glyph, the footer said `Helix - Generated …`, and the accent
colour was Helix teal. `ReportBranding` gains `wordmark`, `showMark`, `accent`
and `chartPalette`, carried on the same channel the existing brand fields use
and published to the components on a context. Neutrals and the semantic tones
stay fixed.

Also fixes `BarChart` with negative values. It took its domain from the maximum
alone, so a negative point produced a `Rect` with a negative height and put its
value label under the axis on top of the category labels. The chart now takes a
signed domain, places the zero line between the extremes, and draws each bar and
its label on the correct side. An all-positive series is unchanged.
