import { expect, test } from '@playwright/test';

test('foundation page reports API and PostgreSQL readiness', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Causality');
  await expect(page.getByRole('heading', { name: '金融因果知识库' })).toBeVisible();
  await expect(page.getByText('正常', { exact: true })).toBeVisible();
  await expect(page.getByText('就绪', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('正常', { exact: true })).toBeVisible();
  await expect(page.getByText('就绪', { exact: true })).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('foundation-desktop.png'),
    fullPage: true,
  });

  expect(browserErrors).toEqual([]);
});
