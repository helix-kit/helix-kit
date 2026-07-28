<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Release / Upgrade Database Schema

The tables behind the release / OTA "upgrades" control plane
(`web/packages/core/helix-backend/src/db/release-schema.ts`). Three planes:
**Catalog** (what exists), **Build** (how it was made), **Distribution** (who gets it).

## Schema map

```mermaid
flowchart TD
  subgraph catalog["Catalog — what exists"]
    AT["artifact_type<br/>(key) descriptor:<br/>selector keys · roles · adapter"]
    R["release<br/>(id) name · version · channel<br/>status · owner_user_id"]
    V["variant<br/>(id) selector → artifact set"]
    VA["variant_artifact<br/>(id) role · offset/path"]
    A["artifact<br/>(id) storage_mode<br/>blob: cas/&lt;sha256&gt;  |  ref: registry+digest"]
    RCH["release_channel_head<br/>(latest) per type · name · channel"]
  end

  subgraph build["Build — how it was made"]
    B["build<br/>(id) source ci|custom<br/>config_hash (Tier-0 dedupe)"]
  end

  subgraph dist["Distribution — who gets it"]
    P["profile"]
    PT["profile_track<br/>follow channel OR pin release<br/>+ selector · auto_update"]
    DP["device_profile"]
    D[("device")]
  end

  CIT["ci_token<br/>scoped publish auth (hashed)"]

  R -->|type_key| AT
  R -->|"1..N"| V
  V -->|"by role"| VA
  VA -->|artifact_id| A
  A -->|type_key| AT
  B -->|"creates on success"| R
  R -. build_id .-> B
  RCH -->|release_id| R
  P --> PT
  PT -->|"channel → head"| RCH
  PT -. pinned_release_id .-> R
  DP --> P
  D --> DP
```

## Resolution flow (what a device's upgrade is)

```mermaid
flowchart LR
  D[("device")] --> DP["device_profile"] --> P["profile"] --> PT["profile_track"]
  PT -->|channel| RCH["release_channel_head"] --> R["release"]
  PT -. pinned .-> R
  R --> V["variant<br/>(selector match)"] --> VA["variant_artifact"] --> A["artifact"]
  A -->|blob| U["signed URL for cas/&lt;sha256&gt;"]
  A -->|ref| C["registry coordinate + digest"]
```

## Notes

- **Solid edges** = hard FK (`variant→release`, `variant_artifact→variant`,
  `profile_track→profile` cascade). **Dotted edges** = logical reference by id
  (no DB FK): `variant_artifact.artifact_id`, `release.build_id`,
  `profile_track.pinned_release_id`, `*.type_key → artifact_type.key`.
- **`artifact` is one table, two modes:** `blob` (content-addressed bytes in
  object storage, unique on `sha256`) or `ref` (external registry coordinate +
  digest, unique on `registry+coordinate+digest`) — so firmware blobs and
  npm/OCI packages share the same shape.
- **CI vs custom** is just `release.owner_user_id` (null = CI/official, set = a
  user's build) and `build.source`.
- **"latest"** is the mutable `release_channel_head` pointer (free-string
  versions aren't orderable); publishing updates it.
- **Tier-0 dedupe** for custom builds keys on `build.config_hash`.
