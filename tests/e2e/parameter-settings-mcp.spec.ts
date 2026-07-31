import { expect, test } from './support/fixtures';

test('MCP settings stay compact and token rotation requires confirmation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let rotationRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/mcp/settings/rotate-token'
    ) {
      rotationRequests += 1;
    }
  });

  await page.goto('/settings');

  const mcpPanel = page.getByRole('region', { name: 'MCP 服务' });
  await expect(mcpPanel).toBeVisible();
  await expect(mcpPanel.getByText('http://127.0.0.1:8081/mcp')).toBeVisible();
  const tokenCode = mcpPanel
    .locator('.mcp-settings-details > div')
    .filter({ hasText: '访问令牌' })
    .locator('code');
  await expect(tokenCode).toContainText('••••');
  await expect(tokenCode).not.toHaveText(/^[0-9a-f]{64}$/u);

  const geometry = await page.evaluate(() => {
    const mcp = document.querySelector<HTMLElement>('.mcp-settings-section')!;
    const semantic = document.querySelector<HTMLElement>('.semantic-settings-section')!;
    const mcpBox = mcp.getBoundingClientRect();
    const semanticBox = semantic.getBoundingClientRect();
    return {
      widthDelta: Math.abs(mcpBox.width - semanticBox.width),
      mcpHeight: mcpBox.height,
      mcpOverflow: mcp.scrollWidth - mcp.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.widthDelta).toBeLessThanOrEqual(1);
  expect(geometry.mcpHeight).toBeLessThan(230);
  expect(geometry.mcpOverflow).toBe(0);
  expect(geometry.pageOverflow).toBe(0);

  await mcpPanel.getByRole('button', { name: '重新生成令牌' }).click();
  const dialog = page.getByRole('dialog', { name: '重新生成 MCP 访问令牌' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('现有客户端将断开');
  expect(rotationRequests).toBe(0);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  expect(rotationRequests).toBe(0);

  await page.screenshot({
    path: testInfo.outputPath('parameter-settings-mcp-1280x720.png'),
    fullPage: true,
  });
});
