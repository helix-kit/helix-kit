# Third-party License Inventory

This file tracks the review status of third-party material included in Helix
release artifacts. It is not a substitute for upstream license texts or NOTICE
files.

## Current status

The repository dependency manifests and lockfiles identify npm, Python, Go, and
ESP-IDF dependencies, but a complete release-specific attribution review has
not yet been completed. Until it is completed, release artifacts must not claim
that every included file is solely copyrighted by the Helix authors.

Before a release:

1. Enumerate the exact dependency versions included in each artifact.
2. Record each dependency's copyright, SPDX license expression, source URL, and
   required notice files.
3. Audit copied UI components, generated sources, firmware SDK code, fonts,
   icons, and media independently of package-manager dependencies.
4. Resolve unknown, proprietary, noncommercial, or license-incompatible items.
5. Bundle all required license and notice texts with the corresponding artifact.
