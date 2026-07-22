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
