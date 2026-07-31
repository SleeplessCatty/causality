import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };
const rootPackageJson = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

describe('API production entrypoints', () => {
  it('uses compiled JavaScript for every production task', () => {
    expect(packageJson.scripts).toMatchObject({
      start: 'node dist/server.js',
      'start:migrate': 'node dist/database/migrate.js',
      'start:seed': 'node dist/database/test-data/fixedSeed.js',
      'start:verify': 'node dist/database/verify.js',
      'start:user-admin': 'node dist/commands/userAdmin.js',
    });

    for (const command of [
      packageJson.scripts.start,
      packageJson.scripts['start:migrate'],
      packageJson.scripts['start:seed'],
      packageJson.scripts['start:verify'],
      packageJson.scripts['start:user-admin'],
    ]) {
      expect(command).not.toContain('tsx');
    }
  });

  it('exposes the six server-only user administration commands without password arguments', () => {
    expect(rootPackageJson.scripts).toMatchObject({
      'user:create': 'pnpm --filter @causality/api user-admin create',
      'user:list': 'pnpm --filter @causality/api user-admin list',
      'user:reset-password': 'pnpm --filter @causality/api user-admin reset-password',
      'user:disable': 'pnpm --filter @causality/api user-admin disable',
      'user:enable': 'pnpm --filter @causality/api user-admin enable',
      'user:unlock': 'pnpm --filter @causality/api user-admin unlock',
    });
  });

  it('copies production dependencies for the shared contracts package', () => {
    expect(dockerfile).toContain(
      '/workspace/packages/contracts/node_modules ./packages/contracts/node_modules',
    );
  });
});
