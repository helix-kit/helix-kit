# Release Compliance

Every released artifact must identify and provide the corresponding source for
the exact version being distributed or operated.

## Required checks

1. Run `bash scripts/check-licenses.sh`.
2. Build from a committed revision. Firmware manifests with `source.dirty` set
   to `true` are development artifacts and must not be published.
3. Set `NEXT_PUBLIC_HELIX_SOURCE_URL` to a durable URL for the exact source
   revision deployed by the web application.
4. Complete `THIRD_PARTY_LICENSES.md` for the exact dependency versions and
   assets included in the release.
5. Bundle `LICENSE`, applicable Creative Commons terms, `NOTICE`, third-party
   notices, build scripts, interface definitions, and installation information
   required by AGPLv3.
6. Keep the corresponding source available for the duration required by the
   license and any written source offer.
