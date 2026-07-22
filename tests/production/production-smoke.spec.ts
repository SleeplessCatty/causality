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
      concreteCases: number;
    };
    valid: boolean;
  };
}

test('production stack boots empty, persists data, and seeds explicitly', async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });

  await page.goto('/events');
  await expect(page.getByRole('heading', { name: '原子事件' })).toBeVisible();
  await page.goto('/graph');
  await expect(page.getByRole('heading', { name: '局部因果图' })).toBeVisible();

  await expect.poll(async () => (await request.get('/api/ready')).status()).toBe(200);
  expect(verifyDatabase()).toMatchObject({
    migrationApplied: true,
    counts: { abstractEvents: 0, causalRelations: 0, concreteCases: 0 },
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
    concreteCases: 18,
  });
  compose(['run', '--rm', 'seed']);
  expect(verifyDatabase().counts).toEqual(afterFirstSeed.counts);

  const serviceRows = compose(['ps', '--all', '--format', 'json'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          Service: string;
          State: string;
          Health: string;
          ExitCode: number;
        },
    );
  const byService = Object.fromEntries(serviceRows.map((row) => [row.Service, row]));
  for (const service of ['postgres', 'api', 'web']) {
    expect(byService[service]).toMatchObject({ State: 'running', Health: 'healthy' });
  }
  expect(byService.migrate).toMatchObject({ State: 'exited', ExitCode: 0 });
  expect(browserErrors).toEqual([]);
});
