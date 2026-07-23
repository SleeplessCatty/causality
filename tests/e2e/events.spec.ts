import { expect, test, type APIRequestContext } from '@playwright/test';

import { E2E_WRITE_BATCH_SIZE, runInBatches } from './support/runInBatches';

const apiBase = 'http://127.0.0.1:3000/api';

async function createEvent(request: APIRequestContext, name: string) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases: [], keywords: [] },
  });
  expect(response.status()).toBe(201);
}

test('event list paginates 211 records and jumps directly from page 1 to page 5', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const token = `E2EPAGE${Date.now()}`;
  await runInBatches(
    Array.from({ length: 211 }, (_, index) => `${token}-${String(index + 1).padStart(3, '0')}`),
    E2E_WRITE_BATCH_SIZE,
    (name) => createEvent(request, name),
  );

  const requestedPages: number[] = [];
  page.on('request', (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (url.pathname !== '/api/events' || url.searchParams.get('q') !== token) return;
    requestedPages.push(Number(url.searchParams.get('page')));
  });

  await page.goto(`/events?q=${token}`);
  await expect(page.getByText('共 211 条 · 第 1/5 页')).toBeVisible();
  await expect(page.locator('.event-table tbody tr')).toHaveCount(50);
  await page.locator('.product-main').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => page.locator('.product-main').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('共 211 条 · 第 2/5 页')).toBeVisible();
  await expect(page.locator('.event-table tbody tr')).toHaveCount(50);
  await expect
    .poll(() => page.locator('.product-main').evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('共 211 条 · 第 1/5 页')).toBeVisible();

  requestedPages.length = 0;
  await page.getByRole('spinbutton', { name: '跳转页码' }).fill('5');
  await page.getByRole('button', { name: '跳转' }).click();
  await expect(page.getByText('共 211 条 · 第 5/5 页')).toBeVisible();
  await expect(page.locator('.event-table tbody tr')).toHaveCount(11);
  await expect(page.getByRole('link', { name: `${token}-211` })).toBeVisible();
  expect(requestedPages).toEqual([5]);
});

test('user can search, create, inspect, edit, and find an atomic event', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  const suffix = `${Date.now()}`;
  const initialName = `E2E 原油供给减少 ${suffix}`;
  const updatedName = `E2E 原油供给持续减少 ${suffix}`;
  const initialAlias = `E2E 油供减少 ${suffix}`;
  const updatedAlias = `E2E 供应收紧 ${suffix}`;

  await page.goto('/events');
  const search = page.getByRole('searchbox', { name: '搜索事件' });
  await search.fill('原油价格上涨');
  await expect(page.getByRole('link', { name: '原油价格上涨' })).toBeVisible();

  await page.getByRole('link', { name: '创建事件' }).first().click();
  await expect(page.getByRole('heading', { name: '创建原子事件' })).toBeVisible();
  await page.getByRole('textbox', { name: '标准名称' }).fill(initialName);
  await page.getByRole('textbox', { name: '事件说明' }).fill('用于浏览器验收的具体事件定义。');
  await page.getByRole('textbox', { name: '添加别名' }).fill(initialAlias);
  await page.getByRole('textbox', { name: '添加别名' }).press('Enter');
  await page.getByRole('textbox', { name: '添加关键词' }).fill('E2E能源');
  await page.getByRole('textbox', { name: '添加关键词' }).press('Enter');
  await page.getByRole('button', { name: '创建事件' }).click();

  await expect(page.getByRole('heading', { name: initialName })).toBeVisible();
  await expect(page.getByText('事件已创建')).toBeVisible();
  await expect(page.getByText(initialAlias)).toBeVisible();
  await expect(page.getByText('E2E能源')).toBeVisible();

  await page.getByRole('link', { name: '编辑事件' }).click();
  await page.getByRole('textbox', { name: '标准名称' }).fill(updatedName);
  await page.getByRole('textbox', { name: '添加别名' }).fill(updatedAlias);
  await page.getByRole('textbox', { name: '添加别名' }).press('Enter');
  await page.getByRole('button', { name: '保存修改' }).click();

  await expect(page).toHaveURL(/\/events$/);
  await search.fill(updatedAlias);
  await expect(page.getByRole('link', { name: updatedName })).toBeVisible();

  await page.getByRole('link', { name: '创建事件' }).first().click();
  await page.getByRole('textbox', { name: '标准名称' }).fill(updatedName);
  await page.getByRole('button', { name: '创建事件' }).click();
  await expect(page.getByText('该标准名称已被使用').first()).toBeVisible();

  expect(browserErrors.filter((message) => !message.includes('409 (Conflict)'))).toEqual([]);
});
