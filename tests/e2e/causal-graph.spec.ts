import { expect, test } from '@playwright/test';

test('user can generate, navigate, restore, and inspect a local causal graph', async ({
  page,
  request,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/events');
  await page.getByRole('link', { name: '因果图' }).click();
  await expect(page).toHaveURL(/\/graph$/);
  await expect(page.getByRole('heading', { name: '局部因果图' })).toBeVisible();
  await expect(page.getByText('搜索并选择一个中心事件')).toBeVisible();

  const selector = page.getByRole('combobox', { name: '中心事件' });
  await selector.fill('原油价格上涨');
  const initialResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/causal-graph?') && response.url().includes('direction=both'),
  );
  await page.getByRole('option', { name: '原油价格上涨' }).click();
  const initialResponse = await initialResponsePromise;
  expect(initialResponse.status()).toBe(200);
  const initialGraph = (await initialResponse.json()) as {
    meta: { nodeCount: number; relationCount: number };
  };

  await expect(page).toHaveURL(/centerEventId=.*&direction=both/);
  const canvas = page.getByRole('img', { name: /原油价格上涨的局部因果图/ });
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(canvas).toHaveAttribute('data-node-count', String(initialGraph.meta.nodeCount));
  await expect(canvas).toHaveAttribute(
    'data-relation-count',
    String(initialGraph.meta.relationCount),
  );

  for (const target of [
    { name: '只看上游', direction: 'upstream' },
    { name: '只看下游', direction: 'downstream' },
    { name: '查看上游和下游', direction: 'both' },
  ] as const) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/causal-graph?') &&
        response.url().includes(`direction=${target.direction}`),
    );
    await page.getByRole('radio', { name: target.name }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      meta: { nodeCount: number; relationCount: number };
    };
    await expect(page).toHaveURL(new RegExp(`direction=${target.direction}`));
    await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
    await expect(canvas).toHaveAttribute('data-node-count', String(body.meta.nodeCount));
    await expect(canvas).toHaveAttribute('data-relation-count', String(body.meta.relationCount));
  }

  await page.reload();
  await expect(selector).toHaveValue('原油价格上涨');
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');

  const zoomOutput = page.getByLabel('当前缩放比例');
  const initialZoom = await zoomOutput.textContent();
  await page.getByRole('button', { name: '放大因果图' }).click();
  await expect(zoomOutput).not.toHaveText(initialZoom ?? '');
  await page.getByRole('button', { name: '缩小因果图' }).click();
  await page.getByRole('button', { name: '适应画布' }).click();

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    const beforePan = await canvas.screenshot();
    await page.mouse.move(canvasBox.x + 24, canvasBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 84, canvasBox.y + 62, { steps: 4 });
    await page.mouse.up();
    const afterPan = await canvas.screenshot();
    expect(afterPan.equals(beforePan)).toBe(false);
  }
  await page.getByRole('button', { name: '适应画布' }).click();

  await page.screenshot({
    path: testInfo.outputPath('causal-graph-desktop.png'),
    fullPage: true,
  });

  const isolatedName = `E2E 孤立事件 ${Date.now()}`;
  const isolatedResponse = await request.post('http://127.0.0.1:3000/api/events', {
    data: { name: isolatedName, description: null, aliases: [], keywords: [] },
  });
  expect(isolatedResponse.status()).toBe(201);
  const isolated = (await isolatedResponse.json()) as { id: string };

  await page.goto(`/graph?centerEventId=${isolated.id}&direction=both`);
  const isolatedCanvas = page.getByRole('img', { name: new RegExp(isolatedName) });
  await expect(isolatedCanvas).toHaveAttribute('data-layout-state', 'ready');
  await expect(isolatedCanvas).toHaveAttribute('data-node-count', '1');
  await expect(isolatedCanvas).toHaveAttribute('data-relation-count', '0');
  await expect(page.getByText('当前方向暂无关联事件')).toBeVisible();

  expect(browserErrors).toEqual([]);
});
