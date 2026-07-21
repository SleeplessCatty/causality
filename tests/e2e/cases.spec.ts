import { expect, test, type APIRequestContext } from '@playwright/test';

const apiBase = 'http://127.0.0.1:3000/api';

async function createEvent(request: APIRequestContext, name: string) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases: [], keywords: [] },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; name: string }>;
}

async function createCase(request: APIRequestContext, content: string) {
  const response = await request.post(`${apiBase}/cases`, { data: { content } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; content: string }>;
}

test('user can create, search, inspect, edit, and detect a duplicate independent case', async ({
  page,
}) => {
  const suffix = `${Date.now()}`.slice(-8);
  const initialContent = `E2E ${suffix} 某公司发布季度盈利预警`;
  const updatedContent = `E2E ${suffix} 某公司下调全年盈利指引`;

  await page.goto('/cases');
  await page.getByRole('link', { name: '创建案例' }).first().click();
  await page.getByRole('textbox', { name: '案例内容' }).fill(initialContent);
  await page.getByRole('button', { name: '创建案例' }).click();

  await expect(page.getByRole('heading', { name: initialContent })).toBeVisible();
  await expect(page.getByText('案例已创建')).toBeVisible();
  await page.getByRole('link', { name: '编辑案例' }).click();
  await page.getByRole('textbox', { name: '案例内容' }).fill(updatedContent);
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('heading', { name: updatedContent })).toBeVisible();

  await page.getByRole('link', { name: '返回案例列表' }).click();
  await page.getByRole('searchbox', { name: '搜索案例' }).fill(suffix);
  await expect(page.getByRole('link', { name: updatedContent })).toBeVisible();

  await page.goto('/cases/new');
  await page.getByRole('textbox', { name: '案例内容' }).fill(updatedContent);
  await page.getByRole('button', { name: '创建案例' }).click();
  await expect(page.getByRole('link', { name: '查看已有案例' })).toBeVisible();
});

test('relation form reuses an existing case, creates a new case, and unlinks without deletion', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}`.slice(-8);
  const cause = await createEvent(request, `E2E 案例原因 ${suffix}`);
  const effect = await createEvent(request, `E2E 案例结果 ${suffix}`);
  const otherEffect = await createEvent(request, `E2E 复用结果 ${suffix}`);
  const existingContent = `E2E ${suffix} 央行宣布下调政策利率`;
  const newContent = `E2E ${suffix} 银行随后下调贷款利率`;
  const existing = await createCase(request, existingContent);

  async function selectEvent(label: '原因事件' | '结果事件', name: string) {
    await page.getByRole('combobox', { name: label }).fill(name);
    await page.getByRole('option', { name }).click();
  }

  await page.goto('/relations/new');
  await selectEvent('原因事件', cause.name);
  await selectEvent('结果事件', effect.name);

  await page.getByRole('button', { name: '添加案例' }).click();
  await page.getByRole('combobox', { name: '具体案例 1' }).fill(existingContent);
  await page.getByRole('option', { name: existingContent }).click();
  await page.getByRole('button', { name: '添加案例' }).click();
  await page.getByRole('combobox', { name: '具体案例 2' }).fill(newContent);
  await page.getByRole('option', { name: `创建新案例：${newContent}` }).click();
  await page.getByRole('button', { name: '创建关系' }).click();

  await expect(page).toHaveURL(/\/relations\?expanded=/);
  const relationRow = page
    .getByRole('row')
    .filter({ hasText: cause.name })
    .filter({ hasText: effect.name });
  await expect(relationRow).toContainText('2');
  await expect(page.getByRole('link', { name: existingContent })).toBeVisible();
  await expect(page.getByRole('link', { name: newContent })).toBeVisible();

  const relationId = new URL(page.url()).searchParams.get('expanded');
  expect(relationId).toBeTruthy();
  await page.getByRole('link', { name: '编辑关系' }).click();
  const existingRow = page.locator('.case-selector-row').filter({
    has: page.locator(`input[value="${existingContent}"]`),
  });
  await existingRow.getByRole('button', { name: '移除案例' }).click();
  await page.getByRole('button', { name: '保存修改' }).click();

  await expect(page).toHaveURL(/\/relations\?expanded=/);
  await expect(page.getByRole('row').filter({ hasText: cause.name })).toContainText('1');
  await expect(page.getByRole('link', { name: newContent })).toBeVisible();
  const caseResponse = await request.get(`${apiBase}/cases/${existing.id}`);
  expect(caseResponse.status()).toBe(200);

  const reused = await request.post(`${apiBase}/relations`, {
    data: {
      causeEventId: cause.id,
      effectEventId: otherEffect.id,
      confidence: 55,
      description: null,
      caseSelections: [{ type: 'existing', caseId: existing.id }],
    },
  });
  expect(reused.status()).toBe(201);
});

test('relation detail shows only five recent cases and links to the complete filtered list', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}`.slice(-8);
  const cause = await createEvent(request, `E2E 最近案例原因 ${suffix}`);
  const effect = await createEvent(request, `E2E 最近案例结果 ${suffix}`);
  const contents = Array.from({ length: 6 }, (_, index) => `E2E ${suffix} 最近案例 ${index + 1}`);
  const response = await request.post(`${apiBase}/relations`, {
    data: {
      causeEventId: cause.id,
      effectEventId: effect.id,
      confidence: 61,
      description: '最近案例展示验证',
      caseSelections: contents.map((content) => ({ type: 'new', content })),
    },
  });
  expect(response.status()).toBe(201);
  const relation = (await response.json()) as { id: string };

  await page.goto(`/relations?expanded=${relation.id}`);
  const caseLinks = page.locator('.relation-inline-cases li a');
  await expect(caseLinks).toHaveCount(5);
  await page.getByRole('link', { name: '查看全部 6 条' }).click();
  await expect(page).toHaveURL(new RegExp(`/cases\\?relationId=${relation.id}`));
  await expect(page.getByText('当前仅显示指定因果关系关联的案例')).toBeVisible();
  await expect(page.locator('.case-table tbody tr')).toHaveCount(6);
});

test('case pages fit the supported desktop viewports', async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const target of [
      { name: 'list', url: '/cases', heading: '具体案例' },
      { name: 'create', url: '/cases/new', heading: '创建具体案例' },
    ]) {
      await page.goto(target.url);
      await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`cases-${target.name}-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    }
  }
});
