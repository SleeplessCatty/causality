import { expect, test } from './support/fixtures';

test('MCP settings forget a saved one-time token and show confirmed revocation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/settings');

  const panel = page.getByRole('region', { name: 'MCP 服务' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('http://127.0.0.1:8081/mcp')).toBeVisible();
  const tokenManagement = panel.getByRole('region', { name: '个人令牌管理' });
  await tokenManagement.getByRole('button', { name: '创建个人令牌' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 MCP 个人令牌' });
  await dialog.getByLabel('令牌名称').fill('Playwright client');
  await dialog.getByRole('button', { name: '创建令牌' }).click();
  await expect(dialog.getByText(/^cau_pat_[A-Za-z0-9_-]{43}$/u)).toBeVisible();
  await expect(dialog).toContainText('此令牌仅显示一次');
  await dialog.getByRole('button', { name: '我已保存' }).click();
  await expect(dialog).toBeHidden();

  await tokenManagement.getByRole('button', { name: '创建个人令牌' }).click();
  await expect(dialog.getByText(/^cau_pat_[A-Za-z0-9_-]{43}$/u)).toHaveCount(0);
  await expect(dialog.getByLabel('令牌名称')).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();

  const activeRow = tokenManagement.getByRole('row', { name: /Playwright client.*有效/ });
  await expect(activeRow).toBeVisible();
  await activeRow.getByRole('button', { name: '撤销' }).click();
  const revokeDialog = page.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
  await revokeDialog.getByRole('button', { name: '确认撤销' }).click();
  const revokedRow = tokenManagement.getByRole('row', { name: /Playwright client.*已撤销/ });
  await expect(revokedRow).toBeVisible();
  await expect(revokedRow.getByRole('button', { name: '撤销' })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('parameter-settings-mcp-1280x720.png'),
    fullPage: true,
  });
});
