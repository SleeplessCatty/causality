import { execFileSync } from 'node:child_process';

import { expect, test, type APIRequestContext } from '@playwright/test';

test.setTimeout(120_000);

async function createDenseGraph(request: APIRequestContext) {
  const output = execFileSync(
    'pnpm',
    ['db:simulate', '--', '--events=130', '--relations=1000', '--cases=0', '--seed=20260721'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://causality:causality@127.0.0.1:5432/causality',
      },
    },
  );
  const result = JSON.parse(output.slice(output.indexOf('{'))) as { batchId: string };
  const centerName = `SIM-${result.batchId}-事件-1`;
  const centerResponse = await request.get('http://127.0.0.1:3000/api/events/candidates', {
    params: { q: centerName, limit: 1 },
  });
  expect(centerResponse.ok()).toBe(true);
  const candidates = (await centerResponse.json()) as {
    items: Array<{ id: string; name: string }>;
  };
  expect(candidates.items).toHaveLength(1);
  return candidates.items[0];
}

test('user can change node limits, filter, restore, and retry a dense local graph', async ({
  page,
  request,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const center = await createDenseGraph(request);

  await page.goto(
    `/graph?centerEventId=${center.id}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
  );
  const canvas = page.getByRole('application', { name: new RegExp(center.name) });
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '21');
  const nodeLimit = page.getByRole('button', { name: '节点上限' });
  const minConfidence = page.getByRole('button', { name: '最低置信度' });
  const minCaseCount = page.getByRole('button', { name: '最少案例数' });

  async function choose(trigger: typeof nodeLimit, option: string) {
    await trigger.click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }

  let failNextFiftyRequest = true;
  await page.route('**/api/causal-graph?**', async (route) => {
    const url = new URL(route.request().url());
    if (failNextFiftyRequest && url.searchParams.get('limit') === '50') {
      failNextFiftyRequest = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'E2E forced failure' }),
      });
      return;
    }
    await route.continue();
  });

  await choose(nodeLimit, '50');
  await expect(page).toHaveURL(/limit=50/);
  await expect(page.getByText('查询失败，保留当前图')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-node-count', '21');
  await page.getByRole('button', { name: '重试因果图查询' }).click();
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '51');
  await page.screenshot({
    path: testInfo.outputPath('causal-graph-50-nodes.png'),
  });

  await choose(nodeLimit, '100');
  await expect(page).toHaveURL(/limit=100/);
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '101');
  const zoomText = await page.getByLabel('当前缩放比例').textContent();
  const zoom = Number.parseInt(zoomText ?? '0', 10);
  expect(zoom).toBeGreaterThanOrEqual(10);
  expect(zoom).toBeLessThan(60);

  await choose(minConfidence, '90%');
  await choose(minCaseCount, '10');
  await expect(page).toHaveURL(/limit=100.*minConfidence=90.*minCaseCount=10/);
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '1');
  await page.screenshot({
    path: testInfo.outputPath('causal-graph-filtered.png'),
  });
  await page.reload();
  await expect(minConfidence).toContainText('90%');
  await expect(minCaseCount).toContainText('10');
  await expect(canvas).toHaveAttribute('data-node-count', '1');

  await choose(minCaseCount, '0');
  await choose(minConfidence, '0%');
  await expect(page).toHaveURL(/limit=100.*minConfidence=0.*minCaseCount=0/);
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '101');

  expect(browserErrors).toEqual([
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  ]);
});
