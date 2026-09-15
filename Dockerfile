# One image, three entrypoints. The API, the worker and the build of the
# browser application all come from the same source tree, so they cannot drift
# apart between deploys.

# ---- dependencies ------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Manifests first, so a source change does not reinstall the world.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/http-kit/package.json packages/http-kit/
COPY packages/kernel/package.json packages/kernel/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
COPY packages/vault/package.json packages/vault/
COPY packages/modules/audit/package.json packages/modules/audit/
COPY packages/modules/identity/package.json packages/modules/identity/

RUN pnpm install --frozen-lockfile

# ---- build -------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
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
RUN pnpm prune --prod && chown -R amc:amc /app/node_modules

USER amc

# The API is the default; compose overrides the command for the worker.
EXPOSE 3000
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]

# ---- the built browser application -------------------------------------
# Static files only, copied into the web server image by compose.
FROM scratch AS web
COPY --from=build /app/apps/web/dist /
