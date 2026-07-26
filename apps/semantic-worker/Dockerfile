FROM node:24.18.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/semantic-core/package.json packages/semantic-core/package.json
COPY apps/semantic-worker/package.json apps/semantic-worker/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY packages/semantic-core packages/semantic-core
COPY apps/semantic-worker apps/semantic-worker

RUN pnpm --filter @causality/contracts build \
  && pnpm --filter @causality/semantic-core build \
  && pnpm --filter @causality/semantic-worker build \
  && pnpm install --prod --frozen-lockfile

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV MODEL_DIRECTORY=/var/lib/causality/models
WORKDIR /workspace

RUN mkdir -p /var/lib/causality/models \
  && chown -R node:node /var/lib/causality

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/semantic-worker/node_modules ./apps/semantic-worker/node_modules
COPY --from=build --chown=node:node /workspace/apps/semantic-worker/package.json ./apps/semantic-worker/package.json
COPY --from=build --chown=node:node /workspace/apps/semantic-worker/dist ./apps/semantic-worker/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/semantic-core/package.json ./packages/semantic-core/package.json
COPY --from=build --chown=node:node /workspace/packages/semantic-core/dist ./packages/semantic-core/dist

USER node
EXPOSE 3100
CMD ["node", "apps/semantic-worker/dist/server.js"]
