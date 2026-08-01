import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, type Page } from '@playwright/test';

import { e2eInitialPassword, e2ePassword, e2eUsername } from './e2eCredentials.js';

export const e2eStorageStatePath = 'tests/e2e/.auth/user.json';
export const e2eCsrfPath = 'tests/e2e/.auth/csrf-token';

export async function authenticateUser(page: Page): Promise<void> {
  await page.goto('/events');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('用户名').fill(e2eUsername);
  await page.getByLabel('密码').fill(e2eInitialPassword);
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/change-initial-password$/);
  await expect(page.getByLabel('初始密码')).toHaveCount(0);
  await page.getByLabel('新密码', { exact: true }).fill(e2ePassword);
  await page.getByLabel('确认新密码', { exact: true }).fill(e2ePassword);
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page).toHaveURL(/\/events$/);

  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'causality_csrf',
  )?.value;
  if (!csrf) throw new Error('Authenticated E2E session has no CSRF cookie');
  await mkdir(dirname(e2eStorageStatePath), { recursive: true });
  await page.context().storageState({ path: e2eStorageStatePath });
  await writeFile(e2eCsrfPath, csrf, { encoding: 'utf8', mode: 0o600 });
}
