import { expect, test } from './support/fixtures';

test('application shell opens events and reports system readiness', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Causality');
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('heading', { name: '原子事件' })).toBeVisible();
  await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'expanded');
  expect(
    (await page.locator('.event-table tbody tr').first().boundingBox())?.height,
  ).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.getByRole('link', { name: '具体案例' }).click();
  await expect(page.getByRole('heading', { name: '具体案例' })).toBeVisible();

  await page.getByRole('link', { name: '数据维护' }).click();
  await expect(page.getByRole('heading', { name: '数据维护' })).toBeVisible();
  await expect(page.getByText('检查数据质量问题并建议处理方案')).toBeVisible();
  await expect(page.getByRole('button', { name: '检查数据' })).toBeVisible();

  await page.getByRole('link', { name: '系统状态' }).click();
  await expect(page.getByText('正常', { exact: true })).toBeVisible();
  await expect(page.getByText('就绪', { exact: true })).toBeVisible();
  await expect(page.getByText('Semantic Worker')).toBeVisible();
  await expect(page.getByText(/异常|无法连接/u)).toBeVisible();

  await page.reload();
  await expect(page.getByText('正常', { exact: true })).toBeVisible();
  await expect(page.getByText('就绪', { exact: true })).toBeVisible();
  await expect(page.getByText(/异常|无法连接/u)).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('foundation-desktop.png'),
    fullPage: true,
  });

  expect(browserErrors).toEqual([]);
});
