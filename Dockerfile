# One image, three entrypoints. The API, the worker and the build of the
# browser application all come from the same source tree, so they cannot drift
# apart between deploys.

# ---- dependencies ------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Manifests first, so a source change does not reinstall the world.
#
# Every workspace member has to be listed. pnpm reads the lockfile against the
# manifests actually present, so a missing one is not a smaller install — it is
# a failed one, and the failure names the lockfile rather than the package.
#
# This list drifted six packages behind the workspace and nobody noticed,
# because this machine has no Docker and nothing ever built the image.
# `scripts/dockerfile-manifests.mjs` now compares the two and fails the gate,
# which is the only reason to trust the list below rather than re-check it.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/http-kit/package.json packages/http-kit/
COPY packages/kernel/package.json packages/kernel/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
COPY packages/vault/package.json packages/vault/
COPY packages/modules/audit/package.json packages/modules/audit/
COPY packages/modules/clients/package.json packages/modules/clients/
COPY packages/modules/deadlines/package.json packages/modules/deadlines/
COPY packages/modules/identity/package.json packages/modules/identity/
COPY packages/modules/notifications/package.json packages/modules/notifications/
COPY packages/modules/services/package.json packages/modules/services/
COPY packages/modules/time-tracking/package.json packages/modules/time-tracking/
COPY packages/modules/whatsapp/package.json packages/modules/whatsapp/

RUN pnpm install --frozen-lockfile

# ---- build -------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .

# Turbo builds every package it can at once, which on a two-gigabyte instance
# means eighteen `tsc -b` processes and a Vite build competing for memory. The
# first build ever attempted was killed by the OOM killer at exactly that
# point, on the same instance size this is deployed to.
#
# Two at a time is barely slower on two vCPUs — the parallelism was never
# buying much there — and it is the difference between a build that finishes
# and one that dies two thirds of the way through with exit 137.
ENV TURBO_CONCURRENCY=2
RUN pnpm build

# ---- the server image --------------------------------------------------
FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production

# Not root. A process that never needs to write outside its own directory
# should not be able to.
RUN addgroup -S amc && adduser -S amc -G amc

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY --from=build --chown=amc:amc /app /app

# Production dependencies only; the build tooling has done its job.
#
# `pnpm install --prod`, not `pnpm prune --prod`. Pruning at the root of a
# workspace prunes the root project: it leaves the packages themselves in the
# virtual store and removes every symlink into it, so `packages/database`
# ends up with an empty node_modules while `postgres@3.4.9` sits in
# `.pnpm/` untouched. The image builds, and the migration container then dies
# with ERR_MODULE_NOT_FOUND for a package that is demonstrably present.
#
# CI=true because both commands stop to ask "the modules directories will be
# removed and reinstalled from scratch, proceed?" and wait for an answer.
# Nobody can answer inside a build, so it hangs rather than fails — silently,
# until something else gives up.
RUN CI=true pnpm install --prod --frozen-lockfile && chown -R amc:amc /app/node_modules

USER amc

# The API is the default; compose overrides the command for the worker.
EXPOSE 3000
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]

# ---- the built browser application -------------------------------------
# Static files only, copied into the web server image by compose.
FROM scratch AS web
COPY --from=build /app/apps/web/dist /
