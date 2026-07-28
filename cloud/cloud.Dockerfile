# syntax=docker/dockerfile:1
# =============================================================================
# cloud/cloud.Dockerfile — thin, COPY-only runtime images for ALL cloud apps.
#
# WHAT THIS IS
#   One file, one stage per image. These images do NOT install or build anything
#   — they only COPY artifacts that the CI "build" step already produced ONCE on
#   the host (`turbo run build`, plus a host `npm install --omit=dev` for each
#   service's runtime node_modules). This replaces the 5 separate per-app builds
#   (each of which ran its own pnpm install + build) with a single shared build.
#
#   The full, self-contained per-app Dockerfiles still live at
#   web/apps/*/Dockerfile and remain independently buildable — this file is only
#   for the optimized build-once pipeline (cloud/build-deploy workflow).
#
# HOW TO BUILD (context = repo root):
#   docker buildx build --target cloud-app                 -f cloud/cloud.Dockerfile -t <ref> .
#   docker buildx build --target cloud-init                -f cloud/cloud.Dockerfile -t <ref> .
#   docker buildx build --target helix-server              -f cloud/cloud.Dockerfile -t <ref> .
#
# REQUIRED ARTIFACTS ON DISK BEFORE BUILDING (the CI build step must produce):
#   web/apps/helix/.next/standalone               (next build, output:'standalone')
#   web/apps/helix/.next/static
#   web/apps/<service>/dist                         (turbo run build → tsdown)
#   cloud/.runtime/<service>/package.json          (scripts/emit-runtime-package.cjs)
#   cloud/.runtime/<service>/node_modules          (host: npm install --omit=dev) — staged
#       OUTSIDE the workspace so it never pollutes lint/turbo
#   web/packages/core/helix-cloud-bootstrap/dist  (turbo run build; self-contained, no node_modules)
#   web/packages/core/helix-cloud-bootstrap/package.json
#   manifests/ , web/manifests/ , web/apps/helix/drizzle/   (source, for cloud-init)
#
#   Host-built (glibc) node_modules are musl-safe here: the only native deps are
#   sharp (cloud-app — pnpm supportedArchitectures fetches the musl variant, which
#   Next traces into standalone) and @msgpackr-extract (ships both libc variants
#   in one package). Helix Server is pure JS. Validated 2026-06-23.
#
#   Keep the build context tight with cloud/cloud.Dockerfile.dockerignore.
# =============================================================================

ARG NODE_IMAGE=node:24-alpine

# ---- cloud-app — Next.js standalone server ----------------------------------
FROM ${NODE_IMAGE} AS cloud-app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# standalone already embeds the traced (pruned) node_modules incl. musl sharp.
COPY --chown=nextjs:nodejs web/apps/helix/.next/standalone ./
COPY --chown=nextjs:nodejs web/apps/helix/.next/static ./apps/helix/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "apps/helix/server.js"]

# ---- cloud-init — DB migrations / bootstrap (self-contained dist) -----------
FROM ${NODE_IMAGE} AS cloud-init
ENV NODE_ENV=production
WORKDIR /app
COPY web/packages/core/helix-cloud-bootstrap/package.json ./package.json
COPY web/packages/core/helix-cloud-bootstrap/dist ./dist
COPY manifests ./manifests
COPY web/manifests ./web/manifests
COPY web/apps/helix/drizzle ./apps/helix/drizzle
CMD ["node", "dist/cli/migrate.js"]

# ---- helix-server — backend runtime, gateway, and device data plane ---------
FROM ${NODE_IMAGE} AS helix-server
ENV NODE_ENV=production
WORKDIR /app
COPY cloud/.runtime/helix-server/package.json ./package.json
COPY cloud/.runtime/helix-server/node_modules ./node_modules
COPY web/apps/helix-server/dist ./dist
EXPOSE 4000 8443
CMD ["node", "dist/index.js"]
