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
