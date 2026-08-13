# Licensing

Unless a file or directory says otherwise, Helix software is licensed under the
GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). The complete
license text is in [`LICENSE`](LICENSE).

Original documentation and non-code media are licensed under Creative Commons
Attribution-ShareAlike 4.0 International (`CC-BY-SA-4.0`). Its complete text is
in [`LICENSES/CC-BY-SA-4.0.txt`](LICENSES/CC-BY-SA-4.0.txt).

## Published SDK packages are MIT

The packages published to npm under the `@helix-hq` scope are licensed under the
MIT License (`MIT`), whose text is in [`LICENSES/MIT.txt`](LICENSES/MIT.txt).
They are libraries other developers install into their own products, and
copyleft would prevent that. Today they are:

| Package | Path |
| --- | --- |
| `@helix-hq/ai-kit` | `web/packages/ai-kit` |
| `@helix-hq/code-executor` | `web/packages/code-executor` |
| `@helix-hq/design-system` | `web/packages/helix-design-system` |
| `@helix-hq/json-schema` | `web/packages/json-schema` |
| `@helix-hq/pdf-report` | `web/packages/pdf-report` |

Each carries its own `LICENSE`, and `.reuse/dep5` scopes MIT to those paths.
Everything else — the apps, the appliance, the device runtime and all firmware —
remains `AGPL-3.0-only`. `scripts/check-licenses.sh` enforces the split.

Generated files carry the output license declared by their source manifest.
Third-party files and dependencies retain their original copyright and license
terms. See [`NOTICE`](NOTICE) and preserve notices distributed with them.

The licenses do not grant permission to use Helix names, logos, or marks to
imply endorsement. See [`TRADEMARKS.md`](TRADEMARKS.md).

## Source availability

If you run a modified Helix program for users over a computer network, AGPLv3
requires offering those users the corresponding source for that running
version. If you distribute binaries, including device firmware, provide the
corresponding source using one of the methods permitted by AGPLv3.

Legally separate programs do not become covered solely because they communicate
with Helix over a network. Whether a combined or linked work is covered depends
on how it is constructed and applicable law.
