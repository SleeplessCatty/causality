import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

const project = process.env.CAUSALITY_SMOKE_PROJECT ?? '';
const port = process.env.CAUSALITY_SMOKE_PORT ?? '18080';
const mcpPort = process.env.CAUSALITY_SMOKE_MCP_PORT ?? '18081';

function compose(args: string[]): string {
  if (!/^causality-smoke-[a-z0-9-]+$/u.test(project)) {
    throw new Error('Unsafe production smoke project name');
  }

  return execFileSync('docker', ['compose', '-p', project, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CAUSALITY_WEB_PORT: port,
      CAUSALITY_MCP_PORT: mcpPort,
    },
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

function verifyWorkerNativeRuntime() {
  return compose([
    'exec',
    '-T',
    'semantic-worker',
    'node',
    '-e',
    [
      "const fs=require('node:fs')",
      "const directory=fs.readdirSync('/workspace/node_modules/.pnpm').find((name)=>name.startsWith('onnxruntime-node@'))",
      "if(!directory)throw new Error('onnxruntime-node missing')",
      "require('/workspace/node_modules/.pnpm/'+directory+'/node_modules/onnxruntime-node')",
      "console.log('onnxruntime_native=ok')",
    ].join(';'),
  ]);
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
  await expect(page.getByRole('region', { name: '局部因果图工作台' })).toBeVisible();

  await expect.poll(async () => (await request.get('/api/ready')).status()).toBe(200);
  const unauthenticatedMcp = await request.post(`http://127.0.0.1:${mcpPort}/mcp`, {
    data: {},
  });
  expect(unauthenticatedMcp.status()).toBe(401);
  expect(verifyWorkerNativeRuntime()).toContain('onnxruntime_native=ok');
  expect(verifyDatabase()).toMatchObject({
    migrationApplied: true,
    counts: { abstractEvents: 0, causalRelations: 0, concreteCases: 0 },
    valid: true,
  });

  const startCheck = await request.post('/api/data-checks');
  expect(startCheck.status()).toBe(202);
  await expect
    .poll(async () => (await request.get('/api/data-checks/latest')).json())
    .toMatchObject({ task: { status: 'succeeded' }, snapshot: { snapshotId: expect.any(String) } });
  const snapshotBeforeRestart = (await (await request.get('/api/data-checks/latest')).json()) as {
    snapshot: { snapshotId: string };
  };

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
  expect(
    (await (await request.get('/api/data-checks/latest')).json()) as {
      snapshot: { snapshotId: string };
    },
  ).toMatchObject({ snapshot: snapshotBeforeRestart.snapshot });

  const orphanEvents = await request.get(
    `/api/events?orphan=true&q=${encodeURIComponent(eventName)}`,
  );
  expect(orphanEvents.status()).toBe(200);
  expect((await orphanEvents.json()) as { totalItems: number }).toMatchObject({ totalItems: 1 });
  expect((await request.get(`/api/events/${created.id}/deletion-impact`)).status()).toBe(200);
  expect((await request.delete(`/api/events/${created.id}`)).status()).toBe(200);
  const deletedOrphans = await request.get(
    `/api/events?orphan=true&q=${encodeURIComponent(eventName)}`,
  );
  expect((await deletedOrphans.json()) as { totalItems: number }).toMatchObject({ totalItems: 0 });

  compose(['run', '--rm', 'seed']);
  const afterFirstSeed = verifyDatabase();
  expect(afterFirstSeed.counts).toMatchObject({
    abstractEvents: 600,
    causalRelations: 500,
    concreteCases: 620,
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
  for (const service of ['postgres', 'api', 'semantic-worker', 'mcp', 'web']) {
    expect(byService[service]).toMatchObject({ State: 'running', Health: 'healthy' });
  }
  expect(byService.migrate).toMatchObject({ State: 'exited', ExitCode: 0 });
  expect(browserErrors).toEqual([]);
});
