import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const scriptUrl = new URL('../../scripts/test-e2e.sh', import.meta.url);
const script = existsSync(scriptUrl) ? readFileSync(scriptUrl, 'utf8') : '';
const playwrightConfig = readFileSync(
  new URL('../../playwright.config.ts', import.meta.url),
  'utf8',
);
const graphSpec = readFileSync(
  new URL('../e2e/causal-graph-expansion-filter.spec.ts', import.meta.url),
  'utf8',
);
const batchHelperUrl = new URL('../e2e/support/runInBatches.ts', import.meta.url);
const batchHelper = existsSync(batchHelperUrl) ? readFileSync(batchHelperUrl, 'utf8') : '';
const paginationSpecs = ['events.spec.ts', 'cases.spec.ts', 'relations.spec.ts'].map((file) =>
  readFileSync(new URL(`../e2e/${file}`, import.meta.url), 'utf8'),
);

test('the root E2E command delegates to the isolated database script', () => {
  assert.equal(packageJson.scripts['test:e2e'], 'bash scripts/test-e2e.sh');
  assert.equal(packageJson.scripts['test:compose'], 'node --test tests/production/*.test.mjs');
  assert.equal(existsSync(scriptUrl), true);
});

test('the E2E script creates and always drops only its unique allowlisted test database', () => {
  assert.match(script, /readonly E2E_DATABASE_NAME="causality_e2e_test_\$\$"/);
  assert.match(script, /\^causality_e2e_test_\[0-9\]\+\$/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /DROP DATABASE IF EXISTS \\"\$E2E_DATABASE_NAME\\" WITH \(FORCE\);/);
  assert.match(script, /CREATE DATABASE \\"\$E2E_DATABASE_NAME\\";/);
  assert.doesNotMatch(script, /DROP DATABASE IF EXISTS causality_e2e_test WITH \(FORCE\);/);
  assert.doesNotMatch(script, /DROP DATABASE IF EXISTS causality WITH \(FORCE\);/);
});

test('the E2E database URL reaches migrations, seeds, Playwright, and graph simulation', () => {
  assert.match(
    script,
    /export DATABASE_URL="postgresql:\/\/causality:causality@127\.0\.0\.1:5432\/\$E2E_DATABASE_NAME"/,
  );
  assert.match(script, /corepack pnpm db:migrate/);
  assert.match(script, /corepack pnpm db:seed/);
  assert.match(script, /corepack pnpm exec playwright test/);
  assert.match(playwrightConfig, /const databaseUrl = process\.env\.DATABASE_URL/);
  assert.match(playwrightConfig, /\^causality_e2e_test_\[0-9\]\+\$/);
  assert.match(playwrightConfig, /reuseExistingServer: false/);
  assert.doesNotMatch(
    playwrightConfig,
    /postgresql:\/\/causality:causality@127\.0\.0\.1:5432\/causality['"]/,
  );
  assert.match(graphSpec, /DATABASE_URL: process\.env\.DATABASE_URL/);
  assert.doesNotMatch(
    graphSpec,
    /postgresql:\/\/causality:causality@127\.0\.0\.1:5432\/causality['"]/,
  );
});

test('large pagination fixtures use a fixed small write batch', () => {
  assert.match(batchHelper, /export const E2E_WRITE_BATCH_SIZE = 10/);
  assert.match(batchHelper, /export async function runInBatches/);
  for (const spec of paginationSpecs) {
    assert.match(spec, /runInBatches\(/);
    assert.match(spec, /E2E_WRITE_BATCH_SIZE/);
  }
});
