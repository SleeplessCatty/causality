import { expect, test } from '@playwright/test';

const centerEventId = '00000000-0000-4000-8000-000000000007';

test('compact shell and full-canvas graph preserve workspace geometry', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/events');
  const shell = page.locator('.product-shell');
  await expect(shell).toHaveAttribute('data-sidebar-state', 'expanded');
  await page.getByRole('button', { name: '收起导航栏' }).click();
  await expect(shell).toHaveAttribute('data-sidebar-state', 'collapsed');
  await page.getByRole('button', { name: '展开导航栏' }).click();
  await expect(shell).toHaveAttribute('data-sidebar-state', 'expanded');

  await page.getByRole('link', { name: '因果图' }).click();
  await expect(shell).toHaveAttribute('data-sidebar-state', 'collapsed');
  await expect(page.getByRole('region', { name: '局部因果图工作台' })).toBeVisible();

  await page.goto(
    `/graph?centerEventId=${centerEventId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
  );
  const canvas = page.getByRole('application', { name: /原油价格上涨的局部因果图/ });
  await expect(canvas).toHaveAttribute('data-layout-state', 'ready');
  const toolbar = page.getByLabel('因果图工具栏');
  const geometry = await page.evaluate(() => {
    const toolbarElement = document.querySelector<HTMLElement>('.causal-graph-toolbar')!;
    const mainElement = document.querySelector<HTMLElement>('.product-main')!;
    const toolbarBox = toolbarElement.getBoundingClientRect();
    const mainBox = mainElement.getBoundingClientRect();
    return {
      toolbarHeight: toolbarBox.height,
      centerDelta: Math.abs(
        toolbarBox.left + toolbarBox.width / 2 - (mainBox.left + mainBox.width / 2),
      ),
      toolbarOverflow: toolbarElement.scrollHeight - toolbarElement.clientHeight,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.toolbarHeight).toBe(52);
  expect(geometry.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.toolbarOverflow).toBe(0);
  expect(geometry.pageOverflow).toBe(0);

  const canvasBoxBeforeInspector = await page.locator('.causal-graph-canvas').boundingBox();
  await canvas.focus();
  await canvas.press('ArrowRight');
  await canvas.press('Space');
  await expect(page.getByRole('complementary', { name: '图元素详情' })).toBeVisible();
  const canvasBoxWithInspector = await page.locator('.causal-graph-canvas').boundingBox();
  expect(canvasBoxWithInspector).toEqual(canvasBoxBeforeInspector);

  await page.getByRole('button', { name: '展开导航栏' }).click();
  await expect(shell).toHaveAttribute('data-sidebar-state', 'expanded');
  const expandedCenterDelta = await page.evaluate(() => {
    const toolbarBox = document
      .querySelector<HTMLElement>('.causal-graph-toolbar')!
      .getBoundingClientRect();
    const mainBox = document.querySelector<HTMLElement>('.product-main')!.getBoundingClientRect();
    return Math.abs(toolbarBox.left + toolbarBox.width / 2 - (mainBox.left + mainBox.width / 2));
  });
  expect(expandedCenterDelta).toBeLessThanOrEqual(1);

  await page.getByRole('link', { name: '事件', exact: true }).click();
  await expect(shell).toHaveAttribute('data-sidebar-state', 'expanded');
  await expect(toolbar).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('compact-events-1280x720.png'),
    fullPage: true,
  });

  expect(browserErrors).toEqual([]);
});
