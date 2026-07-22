# P1-10 Container Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the completed first-phase application as a zero-configuration, local-only production Compose stack with durable PostgreSQL data, automatic migrations, optional seed data, health checks, and isolated production smoke verification.

**Architecture:** Build the existing Fastify API and React Web app into separate multi-stage images. An unprivileged Nginx Web container serves the SPA and proxies `/api` to an internal Node API; PostgreSQL stays internal, a one-shot migrate service gates API startup, and an opt-in tools-profile seed service reuses the API image. Keep source development working through a narrow `compose.dev.yaml` port override and verify production through a uniquely named disposable Compose project.

**Tech Stack:** Docker Compose, `node:24.18.0-alpine`, pnpm 11.15.1, `nginxinc/nginx-unprivileged:1.29.4-alpine`, `postgres:18.4-alpine`, Node.js test runner, Playwright 1.61.1, Bash, existing React 19.2.7/Fastify 5.10.0/PostgreSQL application.

## Global Constraints

- Implement only the approved design in `docs/stages/phase-1/P1-10-phase-1-acceptance-container-delivery-design.md`.
- Production is local-only and exposes only `127.0.0.1:${CAUSALITY_WEB_PORT:-8080}`.
- `docker compose up -d --build --wait` starts the complete production application without an `.env` file.
- Production PostgreSQL and API have no host port mapping.
- Startup migrates an empty database but never loads business seed data automatically.
- `docker compose run --rm seed` is the only production seed-data entry point.
- `compose.dev.yaml` may expose only PostgreSQL on `127.0.0.1:5432` for source development and existing E2E.
- Preserve the current active Docker Context; do not select Docker Desktop or Colima explicitly.
- Production smoke tests must use a validated project name beginning with `causality-smoke-`, port 18080, and a project-scoped disposable volume.
- Never delete the default development/production volume from automated tests.
- Do not change business schemas, business API contracts, page behavior, or add runtime dependencies to application packages.
- Use TDD for production scripts and configuration contracts; commit each independently testable task.

---

### Task 1: API production entry points and image

**Files:**
- Create: `.dockerignore`
- Create: `apps/api/Dockerfile`
- Create: `apps/api/test/production-entrypoints.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: root pnpm workspace, `pnpm-lock.yaml`, API `dist`, `database/migrations`, and existing `DATABASE_URL` configuration.
- Produces: image build context `apps/api/Dockerfile`; commands `start`, `start:migrate`, `start:seed`, and `start:verify`; runtime files `/app/dist`, `/app/node_modules`, and `/database/migrations`.

- [x] **Step 1: Write the failing API production-entrypoint test**

Create `apps/api/test/production-entrypoints.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };

describe('API production entrypoints', () => {
  it('uses compiled JavaScript for every production task', () => {
    expect(packageJson.scripts).toMatchObject({
      start: 'node dist/server.js',
      'start:migrate': 'node dist/database/migrate.js',
      'start:seed': 'node dist/database/test-data/fixedSeed.js',
      'start:verify': 'node dist/database/verify.js',
    });
    for (const command of [
      packageJson.scripts.start,
      packageJson.scripts['start:migrate'],
      packageJson.scripts['start:seed'],
      packageJson.scripts['start:verify'],
    ]) {
      expect(command).not.toContain('tsx');
    }
  });
});
```

- [x] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
pnpm --filter @causality/api exec vitest run test/production-entrypoints.test.ts
```

Expected: FAIL because `start:migrate`, `start:seed`, and `start:verify` are absent.

- [x] **Step 3: Add compiled production scripts**

Add to `apps/api/package.json`:

```json
{
  "scripts": {
    "start": "node dist/server.js",
    "start:migrate": "node dist/database/migrate.js",
    "start:seed": "node dist/database/test-data/fixedSeed.js",
    "start:verify": "node dist/database/verify.js"
  }
}
```

- [x] **Step 4: Add a minimal root Docker context**

Create `.dockerignore`:

```dockerignore
.git
.superpowers
.env
**/.env
**/node_modules
**/dist
**/coverage
playwright-report
test-results
*.log
*.tsbuildinfo
.DS_Store
```

- [x] **Step 5: Create the multi-stage API Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
FROM node:24.18.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY database database

RUN pnpm --filter @causality/contracts build \
  && pnpm --filter @causality/api build \
  && pnpm install --prod --frozen-lockfile

FROM node:24.18.0-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/database/migrations ./database/migrations

USER node
WORKDIR /workspace/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [x] **Step 6: Verify API tests, production build, and image contents**

Run:

```bash
pnpm --filter @causality/api exec vitest run test/production-entrypoints.test.ts
pnpm --filter @causality/api build
docker build -f apps/api/Dockerfile -t causality-api:p1-10 .
docker image inspect causality-api:p1-10 --format '{{.Config.User}} {{.Config.ExposedPorts}}'
```

Expected: focused test and build PASS; Docker build succeeds; inspection reports user `node` and port `3000/tcp`.

- [x] **Step 7: Commit the API image task**

```bash
git add .dockerignore apps/api/Dockerfile apps/api/package.json apps/api/test/production-entrypoints.test.ts
git commit -m "build: add API production image"
```

---

### Task 2: Web production image and reverse proxy

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`
- Create: `apps/web/src/productionContainer.test.ts`

**Interfaces:**
- Consumes: Web Vite build output and internal Compose hostname `api:3000`.
- Produces: unprivileged Web image listening on container port 8080, `/health`, SPA fallback, immutable asset caching, and `/api` reverse proxy.

- [x] **Step 1: Write the failing Web container contract test**

Create `apps/web/src/productionContainer.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Web production container', () => {
  it('serves the SPA and proxies API requests from an unprivileged port', () => {
    const nginx = readFileSync(resolve(process.cwd(), 'nginx.conf'), 'utf8');
    expect(nginx).toContain('listen 8080');
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('proxy_pass http://api:3000');
    expect(nginx).toContain('try_files $uri $uri/ /index.html');
  });

  it('pins the unprivileged Nginx runtime image', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('nginxinc/nginx-unprivileged:1.29.4-alpine');
    expect(dockerfile).not.toContain(':latest');
  });
});
```

- [x] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
pnpm --filter @causality/web exec vitest run src/productionContainer.test.ts
```

Expected: FAIL with `ENOENT` for `nginx.conf` or `Dockerfile`.

- [x] **Step 3: Create the Nginx configuration**

Create `apps/web/nginx.conf`:

```nginx
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location = /health {
    access_log off;
    default_type text/plain;
    return 200 'ok';
  }

  location /api/ {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ~* \.(?:js|css|woff2|png|svg)$ {
    expires 1y;
    add_header Cache-Control 'public, immutable';
    try_files $uri =404;
  }

  location / {
    add_header Cache-Control 'no-cache';
    try_files $uri $uri/ /index.html;
  }
}
```

- [x] **Step 4: Create the multi-stage Web Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
FROM node:24.18.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @causality/contracts build && pnpm --filter @causality/web build

FROM nginxinc/nginx-unprivileged:1.29.4-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
```

- [x] **Step 5: Verify Web tests, build, and image**

Run:

```bash
pnpm --filter @causality/web exec vitest run src/productionContainer.test.ts
pnpm --filter @causality/web build
docker build -f apps/web/Dockerfile -t causality-web:p1-10 .
docker image inspect causality-web:p1-10 --format '{{.Config.User}} {{.Config.ExposedPorts}}'
```

Expected: focused test and Vite build PASS; image build succeeds; runtime exposes `8080/tcp` and uses the unprivileged image user.

- [x] **Step 6: Commit the Web image task**

```bash
git add apps/web/Dockerfile apps/web/nginx.conf apps/web/src/productionContainer.test.ts
git commit -m "build: add Web production image"
```

---

### Task 3: Production Compose topology and development override

**Files:**
- Create: `compose.dev.yaml`
- Create: `tests/production/compose-contract.test.mjs`
- Modify: `compose.yaml`
- Modify: `package.json`

**Interfaces:**
- Consumes: API and Web Dockerfiles from Tasks 1–2.
- Produces: services `postgres`, `migrate`, `api`, `web`, and opt-in `seed`; named volume `causality-postgres-data`; root command `pnpm test:compose`; development PostgreSQL host mapping only in `compose.dev.yaml`.

- [x] **Step 1: Write the failing Compose contract test**

Create `tests/production/compose-contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

function composeConfig(files) {
  const args = ['compose'];
  for (const file of files) args.push('-f', file);
  args.push('--profile', 'tools', 'config', '--format', 'json');
  return JSON.parse(execFileSync('docker', args, { encoding: 'utf8' }));
}

test('production Compose exposes only the Web entry point', () => {
  const config = composeConfig(['compose.yaml']);
  assert.deepEqual(Object.keys(config.services).sort(), [
    'api',
    'migrate',
    'postgres',
    'seed',
    'web',
  ]);
  assert.equal(config.services.api.ports, undefined);
  assert.equal(config.services.postgres.ports, undefined);
  assert.equal(config.services.web.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.web.ports[0].published), '8080');
  assert.deepEqual(config.services.seed.profiles, ['tools']);
  assert.equal(config.services.api.depends_on.migrate.condition, 'service_completed_successfully');
  assert.equal(config.services.web.depends_on.api.condition, 'service_healthy');
});

test('development override exposes only PostgreSQL on loopback', () => {
  const config = composeConfig(['compose.yaml', 'compose.dev.yaml']);
  assert.equal(config.services.postgres.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.postgres.ports[0].published), '5432');
  assert.equal(config.services.api.ports, undefined);
});
```

- [x] **Step 2: Add the failing root script and observe the topology failure**

Add to root `package.json`:

```json
{
  "scripts": {
    "test:compose": "node --test tests/production/compose-contract.test.mjs"
  }
}
```

Run:

```bash
pnpm test:compose
```

Expected: FAIL because only `postgres` exists and it still exposes port 5432.

- [x] **Step 3: Replace `compose.yaml` with the production topology**

Implement these exact service contracts:

```yaml
services:
  postgres:
    image: postgres:18.4-alpine
    environment: &postgres-environment
      POSTGRES_DB: causality
      POSTGRES_USER: causality
      POSTGRES_PASSWORD: causality
    volumes:
      - causality-postgres-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U causality -d causality']
      interval: 2s
      timeout: 3s
      retries: 15
    restart: unless-stopped

  migrate:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment: &api-environment
      NODE_ENV: production
      DATABASE_URL: postgresql://causality:causality@postgres:5432/causality
      CORS_ORIGIN: http://127.0.0.1:${CAUSALITY_WEB_PORT:-8080}
      LOG_LEVEL: ${CAUSALITY_LOG_LEVEL:-info}
    command: ['node', 'dist/database/migrate.js']
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment: *api-environment
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]
      interval: 3s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - '127.0.0.1:${CAUSALITY_WEB_PORT:-8080}:8080'
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8080/health']
      interval: 3s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  seed:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    profiles: ['tools']
    environment: *api-environment
    command: ['node', 'dist/database/test-data/fixedSeed.js']
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: 'no'

volumes:
  causality-postgres-data:
```

- [x] **Step 4: Add the development-only database port mapping**

Create `compose.dev.yaml`:

```yaml
services:
  postgres:
    ports:
      - '127.0.0.1:5432:5432'
```

- [x] **Step 5: Preserve the existing source E2E database startup**

In root `package.json`, change only the Compose portion of `test:e2e` to:

```json
"docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres"
```

Keep the existing contracts build, migration, seed, and Playwright commands after it.

- [x] **Step 6: Verify static topology and source-development compatibility**

Run:

```bash
pnpm test:compose
docker compose config --quiet
docker compose -f compose.yaml -f compose.dev.yaml config --quiet
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm db:migrate
pnpm db:verify
```

Expected: all commands PASS; production config publishes only Web; development config makes the existing local database tools work.

- [x] **Step 7: Commit the Compose topology task**

```bash
git add compose.yaml compose.dev.yaml package.json tests/production/compose-contract.test.mjs
git commit -m "build: add production Compose topology"
```

---

### Task 4: Isolated production smoke test

**Files:**
- Create: `playwright.production.config.ts`
- Create: `scripts/test-production-compose.sh`
- Create: `tests/production/production-smoke.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: production `compose.yaml`, port override `CAUSALITY_WEB_PORT`, API verify entry point, and fixed seed task.
- Produces: root command `pnpm test:production`; environment `PRODUCTION_BASE_URL`, `CAUSALITY_SMOKE_PROJECT`, and `CAUSALITY_SMOKE_PORT`; isolated Compose project and volume lifecycle.

- [ ] **Step 1: Add the production Playwright config and smoke specification first**

Create `playwright.production.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PRODUCTION_BASE_URL ?? 'http://127.0.0.1:18080',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
});
```

Create `tests/production/production-smoke.spec.ts` with these helpers and assertions:

```ts
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const project = process.env.CAUSALITY_SMOKE_PROJECT ?? '';
const port = process.env.CAUSALITY_SMOKE_PORT ?? '18080';

function compose(args: string[]): string {
  if (!/^causality-smoke-[a-z0-9-]+$/u.test(project)) {
    throw new Error('Unsafe production smoke project name');
  }
  return execFileSync('docker', ['compose', '-p', project, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, CAUSALITY_WEB_PORT: port },
  });
}

function verifyDatabase() {
  const output = compose(['run', '--rm', 'api', 'node', 'dist/database/verify.js']);
  return JSON.parse(output.slice(output.indexOf('{'))) as {
    migrationApplied: boolean;
    counts: {
      abstractEvents: number;
      causalRelations: number;
      concreteCausalCases: number;
    };
    valid: boolean;
  };
}

test('production stack boots empty, persists data, and seeds explicitly', async ({ page, request }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: '原子事件' })).toBeVisible();
  await page.goto('/graph');
  await expect(page.getByRole('heading', { name: '局部因果图' })).toBeVisible();

  await expect.poll(async () => (await request.get('/api/ready')).status()).toBe(200);
  expect(verifyDatabase()).toMatchObject({
    migrationApplied: true,
    counts: { abstractEvents: 0, causalRelations: 0, concreteCausalCases: 0 },
    valid: true,
  });

  const eventName = `生产持久化测试 ${Date.now()}`;
  const create = await request.post('/api/events', {
    data: { name: eventName, description: null, aliases: [], keywords: [] },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as { id: string };

  compose(['down']);
  compose(['up', '-d', '--wait']);
  await expect.poll(async () => (await request.get('/api/ready')).status()).toBe(200);
  expect((await request.get(`/api/events/${created.id}`)).status()).toBe(200);

  compose(['run', '--rm', 'seed']);
  const afterFirstSeed = verifyDatabase();
  expect(afterFirstSeed.counts).toMatchObject({
    abstractEvents: 13,
    causalRelations: 15,
    concreteCausalCases: 18,
  });
  compose(['run', '--rm', 'seed']);
  expect(verifyDatabase().counts).toEqual(afterFirstSeed.counts);

  const serviceRows = compose(['ps', '--all', '--format', 'json'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      Service: string;
      State: string;
      Health: string;
      ExitCode: number;
    });
  const byService = Object.fromEntries(serviceRows.map((row) => [row.Service, row]));
  for (const service of ['postgres', 'api', 'web']) {
    expect(byService[service]).toMatchObject({ State: 'running', Health: 'healthy' });
  }
  expect(byService.migrate).toMatchObject({ State: 'exited', ExitCode: 0 });
});
```

- [ ] **Step 2: Add the missing root command and observe the expected failure**

Add to root `package.json`:

```json
{
  "scripts": {
    "test:production": "bash scripts/test-production-compose.sh"
  }
}
```

Run:

```bash
pnpm test:production
```

Expected: FAIL because `scripts/test-production-compose.sh` does not exist.

- [ ] **Step 3: Implement the safety-scoped smoke orchestrator**

Create `scripts/test-production-compose.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

smoke_project="causality-smoke-$$"
smoke_port="${CAUSALITY_SMOKE_PORT:-18080}"

if [[ ! "$smoke_project" =~ ^causality-smoke-[a-z0-9-]+$ ]]; then
  echo "Unsafe production smoke project name" >&2
  exit 1
fi

cleanup() {
  CAUSALITY_WEB_PORT="$smoke_port" docker compose -p "$smoke_project" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

CAUSALITY_WEB_PORT="$smoke_port" docker compose -p "$smoke_project" config --quiet
CAUSALITY_WEB_PORT="$smoke_port" docker compose -p "$smoke_project" up -d --build --wait

PRODUCTION_BASE_URL="http://127.0.0.1:${smoke_port}" \
CAUSALITY_SMOKE_PROJECT="$smoke_project" \
CAUSALITY_SMOKE_PORT="$smoke_port" \
pnpm exec playwright test --config=playwright.production.config.ts
```

Make it executable:

```bash
chmod +x scripts/test-production-compose.sh
```

- [ ] **Step 4: Run the production smoke test and fix only evidence-backed container issues**

Run:

```bash
pnpm test:production
```

Expected: production images build; empty stack becomes healthy; SPA/API checks, persistence, explicit seed, and seed idempotency PASS; the script removes only the `causality-smoke-*` project and its volume.

If the run fails, inspect only the isolated project before cleanup by temporarily commenting out the trap during local diagnosis, then restore the trap before committing. Do not run `docker system prune`, delete the default `causality` volume, or widen the cleanup target.

- [ ] **Step 5: Re-run the Compose contract after smoke orchestration**

Run:

```bash
pnpm test:compose
docker compose ps --all
```

Expected: Compose contract PASS; no `causality-smoke-*` containers remain. The default project is not created or modified by the smoke test.

- [ ] **Step 6: Commit the production smoke task**

```bash
git add package.json playwright.production.config.ts scripts/test-production-compose.sh tests/production/production-smoke.spec.ts
git commit -m "test: add production Compose smoke verification"
```

---

### Task 5: Delivery documentation and first-phase regression gate

**Files:**
- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-10-phase-1-acceptance-container-delivery-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-21-p1-10-container-delivery-implementation.md`

**Interfaces:**
- Consumes: all production and development commands implemented in Tasks 1–4.
- Produces: user-facing production/development runbooks, destructive-reset warning, known limitations, exact P1-10 manual checklist, and roadmap status `等待人工复核`.

- [ ] **Step 1: Rewrite README startup around the production default**

Document these exact primary commands near the top of `README.md`:

```bash
# Complete production application
docker compose up -d --build --wait
# Open http://127.0.0.1:8080

# Source development
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm dev
```

Add separate sections for:

- `docker compose ps --all`;
- `docker compose logs -f web api migrate postgres`;
- `docker compose down` preserving data;
- `docker compose run --rm seed` as optional demo data;
- `CAUSALITY_WEB_PORT` and `CAUSALITY_LOG_LEVEL` overrides;
- Colima/Docker Desktop compatibility through the active Context;
- a clearly labeled destructive reset using `docker compose down --volumes`, stating that it permanently deletes all application data;
- `pnpm test:compose` and `pnpm test:production`;
- the ten first-phase known limitations copied from the approved design.

- [ ] **Step 2: Record automated verification without marking P1-10 complete**

After all gates pass, update:

- P1-10 design status to `开发与自动化测试完成，等待人工复核`;
- roadmap P1-10 status to `等待人工复核`;
- implementation-plan status to the same meaning;
- the exact unit, integration, source E2E, Compose contract, production smoke, image-build, and visual-browser results.

Do not mark P1-10 or Phase 1 complete before the user reports successful manual verification.

- [ ] **Step 3: Run the complete local quality gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm test:compose
pnpm test:production
git diff --check
```

Expected: every command PASS. Record exact test counts and any non-failing build warnings in the design and implementation-plan status.

- [ ] **Step 4: Inspect the real production browser and container state**

Start the default stack:

```bash
docker compose up -d --build --wait
docker compose ps --all
```

At 1280×720 verify in a real browser:

- `/events`, `/relations`, `/cases`, `/graph`, and `/system` load through port 8080;
- direct refresh of `/graph` returns the app rather than Nginx 404;
- `/api/health` and `/api/ready` work through Nginx;
- an empty production volume shows no fixed business data;
- browser console has no unexpected errors.

Stop with `docker compose down` after visual inspection so the named volume remains available for user manual review.

- [ ] **Step 5: Commit the delivery documentation and gate results**

```bash
git add README.md docs/stages/phase-1/P1-10-phase-1-acceptance-container-delivery-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md docs/superpowers/plans/2026-07-21-p1-10-container-delivery-implementation.md
git commit -m "docs: prepare P1-10 container acceptance"
```

- [ ] **Step 6: Hand off the P1-10 manual acceptance checklist**

Report:

- the production URL and exact start command;
- container and migration status;
- automated counts and smoke-test evidence;
- the 14 manual checks from Section 14 of the approved design;
- that P1-10 and Phase 1 remain `等待人工复核`.

Wait for the user. Only after explicit acceptance may a separate documentation commit mark P1-10 and Phase 1 complete and request whether to begin Phase 2 planning.
