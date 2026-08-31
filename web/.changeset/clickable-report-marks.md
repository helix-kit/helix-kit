---
'@helix-hq/pdf-report': minor
---

Tables and pie charts can link back to whatever they summarise.

A report is usually a summary of something the reader then wants to open, and
until now it was a dead end — the only way to link was the stock `Link`
component, which draws blue underlined text and so could not be used inside a
table without making every linked row look unlike the rows around it.

`DataTable` takes `rowLinks` alongside `rows` and `PieChart` takes `links`
alongside `series`, each positional to what it already draws, with `null` for an
entry that is not a link. Both are decided in the code step, like every other
value these components render.

Nothing is drawn differently for being a link. The clickable region is an
annotation laid over the row or slice rather than styling applied to it, so the
marks on the page are identical whether or not a table is linked — there is a
test that renders both and compares the inflated content streams to hold that.

A slice is a wedge and a PDF annotation is a rectangle, so a slice's region is
the largest square that stays inside it, centred on the slice. Slices too thin
to hold a usable one get none; their legend entry carries the same link and is
always a full-size target, which is how a sliver stays reachable.

Only `http`, `https` and `mailto` are emitted. Template code is user-authored
and a rendered report gets forwarded, so anything else is dropped — including a
relative path, which a PDF has no base to resolve against.
