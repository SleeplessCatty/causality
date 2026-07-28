FROM node:24.18.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/mcp/package.json apps/mcp/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/mcp apps/mcp

RUN pnpm --filter @causality/contracts build \
  && pnpm --filter @causality/mcp build \
  && pnpm install --prod --frozen-lockfile

FROM node:24.18.0-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8081
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=build --chown=node:node /workspace/apps/mcp/package.json ./apps/mcp/package.json
COPY --from=build --chown=node:node /workspace/apps/mcp/dist ./apps/mcp/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist

USER node
EXPOSE 8081
CMD ["node", "apps/mcp/dist/http.js"]
