import { expect, test, type APIRequestContext } from '@playwright/test';

import { E2E_WRITE_BATCH_SIZE, runInBatches } from './support/runInBatches';

const apiBase = 'http://127.0.0.1:3000/api';

async function createEvent(request: APIRequestContext, name: string) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases: [], keywords: [] },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; name: string }>;
}

test('relation list shows totals and numbered pages for 31 recognizable records', async ({
  page,
  request,
}) => {
  const token = `RELPAGE${Date.now()}`;
  const cause = await createEvent(request, `${token}-共同原因`);
  const effectNames = Array.from(
    { length: 31 },
    (_, index) => `${token}-结果-${String(index + 1).padStart(2, '0')}`,
  );
  const effects: Array<{ id: string; name: string }> = [];
  await runInBatches(effectNames, E2E_WRITE_BATCH_SIZE, async (name) => {
    effects.push(await createEvent(request, name));
  });
  for (const effect of effects) {
    const response = await request.post(`${apiBase}/relations`, {
      data: {
        causeEventId: cause.id,
        effectEventId: effect.id,
        confidence: 50,
        description: null,
        caseSelections: [],
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto(`/relations?q=${token}`);
  await expect(page.getByText('共 31 条 · 第 1/2 页')).toBeVisible();
  await expect(page.locator('.relation-table tbody tr')).toHaveCount(30);
  const firstPageEffects = await page
    .locator('.relation-table tbody tr td:nth-child(3)')
    .allTextContents();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('共 31 条 · 第 2/2 页')).toBeVisible();
  await expect(page.locator('.relation-table tbody tr')).toHaveCount(1);
  const secondPageEffects = await page
    .locator('.relation-table tbody tr td:nth-child(3)')
    .allTextContents();
  expect(secondPageEffects.every((name) => !firstPageEffects.includes(name))).toBe(true);
});

test('user can create a reverse relation, inspect it inline, edit it, and find it', async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  const suffix = `${Date.now()}`;
  const causeName = `E2E 原因事件 ${suffix}`;
  const effectName = `E2E 结果事件 ${suffix}`;

  const cause = await createEvent(request, causeName);
  const effect = await createEvent(request, effectName);
  const forward = await request.post('http://127.0.0.1:3000/api/relations', {
    data: {
      causeEventId: cause.id,
      effectEventId: effect.id,
      confidence: 72,
      description: 'E2E 已有正向关系',
    },
  });
  expect(forward.status()).toBe(201);

  async function selectEvent(label: '原因事件' | '结果事件', name: string) {
    await page.getByRole('combobox', { name: label }).fill(name);
    await page.getByRole('option', { name }).click();
  }

  await page.goto('/relations/new');
  await selectEvent('原因事件', causeName);
  await selectEvent('结果事件', effectName);
  await expect(page.getByText('该方向的因果关系已存在', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建关系' })).toBeDisabled();

  await page.goto('/relations/new');
  await selectEvent('原因事件', effectName);
  await selectEvent('结果事件', causeName);

  await expect(page.getByText('反向关系已存在', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看反向关系' })).toBeVisible();
  await page.getByRole('spinbutton', { name: '置信度数值' }).fill('76');
  await page.getByRole('textbox', { name: '关系说明' }).fill('E2E 反向关系说明');
  await page.getByRole('button', { name: '创建关系' }).click();

  await expect(page).toHaveURL(/\/relations\/[0-9a-f-]+$/);
  await expect(page.getByText('E2E 反向关系说明', { exact: true })).toBeVisible();
  await expect(page.getByText('76%', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '编辑因果关系' }).click();
  await page.getByRole('spinbutton', { name: '置信度数值' }).fill('79');
  await page.getByRole('button', { name: '保存修改' }).click();

  await expect(page).toHaveURL(/\/relations$/);
  const savedRow = page
    .getByRole('row')
    .filter({ hasText: causeName })
    .filter({ hasText: effectName })
    .filter({ hasText: '79%' });
  await expect(savedRow).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索因果关系' });
  await search.fill(suffix);
  const updatedRow = page.getByRole('row').filter({ hasText: '79%' });
  await expect(updatedRow.getByRole('link', { name: effectName })).toBeVisible();
  await expect(updatedRow.getByRole('link', { name: causeName })).toBeVisible();
  await updatedRow.getByRole('link', { name: effectName }).click();
  await expect(page.getByRole('heading', { name: effectName })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('relation pages fit the supported desktop viewports', async ({ page }, testInfo) => {
  const fixedRelationId = '00000000-0000-4000-8100-000000000001';
  const pages = [
    { name: 'list', url: '/relations', heading: '因果关系' },
    {
      name: 'expanded',
      url: `/relations?expanded=${fixedRelationId}`,
      heading: '因果关系',
    },
    {
      name: 'detail',
      url: `/relations/${fixedRelationId}`,
      heading: /央行提高政策利率.*市场流动性收紧/,
    },
    { name: 'create', url: '/relations/new', heading: '创建因果关系' },
    {
      name: 'edit',
      url: `/relations/${fixedRelationId}/edit`,
      heading: '编辑因果关系',
    },
  ];

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const target of pages) {
      await page.goto(target.url);
      await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
      if (target.name === 'list') {
        expect(
          (await page.locator('.relation-table tbody tr').first().boundingBox())?.height,
        ).toBeLessThanOrEqual(60);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${target.name}-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    }
  }
});
