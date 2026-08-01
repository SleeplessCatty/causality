import { expect, test } from './support/fixtures';

test('MCP settings create a one-time personal token and confirm revocation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/settings');

  const panel = page.getByRole('region', { name: 'MCP 服务' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('http://127.0.0.1:8081/mcp')).toBeVisible();
  await panel.getByRole('button', { name: '创建个人令牌' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 MCP 个人令牌' });
  await dialog.getByLabel('令牌名称').fill('Playwright client');
  await dialog.getByRole('button', { name: '创建令牌' }).click();
  await expect(dialog.getByText(/^cau_pat_[A-Za-z0-9_-]{43}$/u)).toBeVisible();
  await expect(dialog).toContainText('此令牌仅显示一次');
  await dialog.getByRole('button', { name: '我已保存' }).click();
  await expect(panel.getByRole('row', { name: /Playwright client/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('parameter-settings-mcp-1280x720.png'),
    fullPage: true,
  });
});
