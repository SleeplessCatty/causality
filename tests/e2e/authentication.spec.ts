import { expect, test } from './support/fixtures';
import { e2ePassword, e2eUsername } from './support/e2eCredentials';

test('desktop session redirects anonymous users and supports login and current-session logout', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto('/relations');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('用户名').fill(e2eUsername);
    await page.getByLabel('密码').fill(e2ePassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL(/\/relations$/);

    await page.getByRole('button', { name: '打开当前用户菜单' }).click();
    await page.getByRole('menuitem', { name: '退出当前会话' }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});

test('voluntary password change cancel returns to the originating page without logging out', async ({
  page,
}) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();

  await page.getByRole('button', { name: '打开当前用户菜单' }).click();
  await page.getByRole('menuitem', { name: '修改密码' }).click();
  await expect(page).toHaveURL(/\/change-initial-password$/);
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();

  await page.getByRole('button', { name: '取消' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();
});
