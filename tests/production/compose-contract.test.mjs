import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const workerDockerfile = readFileSync(
  new URL('../../apps/semantic-worker/Dockerfile', import.meta.url),
  'utf8',
);
const apiDockerfile = readFileSync(new URL('../../apps/api/Dockerfile', import.meta.url), 'utf8');

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
    'semantic-worker',
    'web',
  ]);
  assert.equal(config.services.api.ports, undefined);
  assert.equal(config.services.postgres.ports, undefined);
  assert.equal(config.services['semantic-worker'].ports, undefined);
  assert.equal(config.services.web.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.web.ports[0].published), '8080');
  assert.equal(config.services.postgres.image, 'pgvector/pgvector:0.8.2-pg18');
  assert.deepEqual(config.services.seed.profiles, ['tools']);
  assert.ok(config.services.api.build);
  assert.ok(config.services['semantic-worker'].build);
  assert.equal(config.services.migrate.build, undefined);
  assert.equal(config.services.seed.build, undefined);
  assert.equal(config.services.migrate.image, config.services.api.image);
  assert.equal(config.services.seed.image, config.services.api.image);
  assert.equal(config.services.api.environment.SEMANTIC_WORKER_URL, 'http://semantic-worker:3100');
  assert.equal(config.services.api.depends_on.migrate.condition, 'service_completed_successfully');
  assert.equal(
    config.services['semantic-worker'].depends_on.migrate.condition,
    'service_completed_successfully',
  );
  assert.equal(config.services.web.depends_on.api.condition, 'service_healthy');
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    'causality-postgres-data',
    'causality-semantic-models',
  ]);
  assert.ok(
    config.services['semantic-worker'].volumes.some(
      (volume) =>
        volume.type === 'volume' &&
        volume.source === 'causality-semantic-models' &&
        volume.target === '/var/lib/causality/models',
    ),
  );
  assert.match(workerDockerfile, /FROM node:24\.18\.0-bookworm-slim AS build/);
  assert.match(workerDockerfile, /FROM node:24\.18\.0-bookworm-slim AS runtime/);
  assert.doesNotMatch(workerDockerfile, /alpine/);
  assert.match(workerDockerfile, /USER node/);
  assert.match(workerDockerfile, /CMD \["node", "apps\/semantic-worker\/dist\/server\.js"\]/);
  assert.match(apiDockerfile, /COPY packages\/semantic-core packages\/semantic-core/);
  assert.match(apiDockerfile, /pnpm --filter @causality\/semantic-core build/);
});

test('development override exposes only PostgreSQL on loopback', () => {
  const config = composeConfig(['compose.yaml', 'compose.dev.yaml']);

  assert.equal(config.services.postgres.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.postgres.ports[0].published), '5432');
  assert.equal(config.services.api.ports, undefined);
});
