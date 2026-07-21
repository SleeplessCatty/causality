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

test('user can expand, filter, restore, and retry a dense local graph', async ({
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
  await expect(page.getByRole('button', { name: '扩展至 50 节点' })).toBeVisible();

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

  await page.getByRole('button', { name: '扩展至 50 节点' }).click();
  await expect(page).toHaveURL(/limit=50/);
  await expect(page.getByText('查询失败，仍显示上一查询结果')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-node-count', '21');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '51');
  await expect(page.getByRole('button', { name: '扩展至 100 节点' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('causal-graph-50-nodes.png'),
  });

  await page.getByRole('button', { name: '扩展至 100 节点' }).click();
  await expect(page).toHaveURL(/limit=100/);
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '101');
  await expect(page.getByText('已达到 100 节点显示上限')).toBeVisible();
  const zoomText = await page.getByLabel('当前缩放比例').textContent();
  expect(Number.parseInt(zoomText ?? '0', 10)).toBeGreaterThanOrEqual(60);

  await page.getByRole('button', { name: '调整筛选' }).click();
  await expect(page.getByRole('region', { name: '筛选因果关系' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('causal-graph-100-filter.png'),
  });
  await page.getByRole('textbox', { name: '最少案例数' }).fill('999');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page).toHaveURL(/limit=20.*minConfidence=0.*minCaseCount=999/);
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', '1');
  await expect(page.getByText('当前条件下已展示全部可达内容')).toBeVisible();
  await expect(page.getByRole('button', { name: /扩展至/ })).toHaveCount(0);

  await page.getByRole('button', { name: '筛选 1' }).click();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(page).toHaveURL(/limit=20.*minConfidence=0.*minCaseCount=0/);
  await expect(canvas).toHaveAttribute('data-node-count', '21');
  await page.goBack();
  await expect(page).toHaveURL(/minCaseCount=999/);
  await expect(canvas).toHaveAttribute('data-node-count', '1');

  expect(browserErrors).toEqual([
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  ]);
});
