import { expect, test } from './support/fixtures';

test('MCP settings reveal, copy, configure, and hard-delete a recoverable token', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/settings');

  const panel = page.getByRole('region', { name: 'MCP 服务' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('http://127.0.0.1:8081/mcp')).toBeVisible();
  const tokenManagement = panel.getByRole('region', { name: '个人令牌管理' });
  await tokenManagement.getByRole('button', { name: '创建个人令牌' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 MCP 个人令牌' });
  await dialog.getByLabel('令牌名称').fill('Playwright token');
  await dialog.getByRole('button', { name: '创建令牌' }).click();
  await expect(dialog).toBeHidden();

  const row = tokenManagement.getByRole('row', { name: /Playwright token/ });
  await expect(row).toBeVisible();
  const mask = row.getByText(/^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/u);
  await expect(mask).toBeVisible();
  await expect(tokenManagement.getByRole('columnheader', { name: '状态' })).toHaveCount(0);

  await row.getByRole('button', { name: '查看' }).click();
  const plaintext = row.getByText(/^cau_pat_[A-Za-z0-9_-]{43}$/u);
  await expect(plaintext).toBeVisible();
  const token = await plaintext.textContent();
  if (!token) throw new Error('Recovered MCP token is empty');
  await row.getByRole('button', { name: '隐藏' }).click();
  await expect(plaintext).toHaveCount(0);
  await expect(mask).toBeVisible();

  await row.getByRole('button', { name: '复制令牌' }).click();
  await expect(tokenManagement.getByText('令牌已复制')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  await expect(plaintext).toHaveCount(0);

  await row.getByRole('button', { name: '复制完整 JSON 配置' }).click();
  await expect(tokenManagement.getByText('JSON 配置已复制')).toBeVisible();
  const configuration = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    mcpServers: { causality: { headers: { Authorization: string } } };
  };
  expect(configuration.mcpServers.causality.headers.Authorization).toBe(`Bearer ${token}`);
  await expect(plaintext).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath('recoverable-mcp-token-settings.png'),
    fullPage: true,
  });

  await row.getByRole('button', { name: '撤销' }).click();
  const revokeDialog = page.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
  await revokeDialog.getByRole('button', { name: '确认撤销' }).click();
  await expect(row).toHaveCount(0);
});
