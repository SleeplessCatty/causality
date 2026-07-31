import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './support/fixtures';

import { apiBase } from './support/urls';

function quotedRow(fields: readonly string[]): string {
  return `${fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(',')}\n`;
}

function csvFile(name: string, text: string) {
  return {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  };
}

async function uploadCsv(request: APIRequestContext, name: string, text: string) {
  const response = await request.post(`${apiBase}/data-transfers/imports`, {
    multipart: { file: csvFile(name, text) },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    batch: {
      id: string;
      counts: Record<string, { created: number; reused: number }>;
    };
  };
}

async function chooseFile(page: Page, name: string, text: string): Promise<void> {
  await page.getByLabel('选择 CSV 文件').setInputFiles(csvFile(name, text));
}

test('CSV import keeps valid logical records, preserves punctuation, and reuses only database data', async ({
  page,
  request,
}) => {
  const token = `E2E导入${Date.now()}`;
  const cause = `${token}原因`;
  const effect = `${token}结果`;
  const caseText = `${token}案例包含,逗号\n以及"双引号"`;
  const csv =
    quotedRow(['原子事件', cause, '首次说明', '原因别名', '测试']) +
    quotedRow(['原子事件', effect]) +
    quotedRow(['具体案例', caseText]) +
    `原子事件,"${token}未引用类型"\n` +
    quotedRow(['因果关系', cause, effect, '72', '关系包含,逗号', caseText]);

  await page.goto('/data-transfer?tab=import&page=1');
  await chooseFile(page, `${token}-包含很长名称用于验证提示.csv`, csv);
  await page.getByRole('button', { name: '开始导入' }).click();

  await expect(page).toHaveURL(/\/data-transfer\/imports\/[0-9a-f-]+/u);
  await expect(page.getByText('新增 2 / 复用 0')).toBeVisible();
  await page.getByRole('tab', { name: '具体案例' }).click();
  await expect(page.getByRole('cell', { name: /案例包含,逗号/u })).toBeVisible();
  await page.getByRole('tab', { name: '因果关系' }).click();
  await expect(
    page.getByRole('cell', { name: new RegExp(`${cause} → ${effect}`, 'u') }),
  ).toBeVisible();

  const second = await uploadCsv(request, `${token}-再次导入.csv`, csv);
  expect(second.batch.counts).toMatchObject({
    event: { created: 0, reused: 2 },
    case: { created: 0, reused: 1 },
    relation: { created: 0, reused: 1 },
    relationCase: { created: 0, reused: 1 },
  });

  await page.goto('/data-transfer?tab=import&page=1');
  const historyRow = page.getByRole('row').filter({ hasText: `${token}-再次导入.csv` });
  await expect(historyRow).toContainText('新增 0 / 复用 2');
  await expect(historyRow).toContainText('新增 0 / 复用 1');
});

test('pending import blocks navigation and a lost response is recoverable from history', async ({
  page,
}) => {
  const token = `E2E恢复${Date.now()}`;
  const blockerCsv = quotedRow(['原子事件', `${token}阻止离开`]);

  await page.goto('/data-transfer?tab=import&page=1');
  await page.route(
    '**/api/data-transfers/imports',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await route.continue();
    },
    { times: 1 },
  );
  await chooseFile(page, `${token}-阻止离开.csv`, blockerCsv);
  await page.getByRole('button', { name: '开始导入' }).click();
  await page.getByRole('link', { name: '系统状态' }).click();
  const leaveDialog = page.getByRole('dialog', { name: '离开导入页面' });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole('button', { name: '继续导入' }).click();
  await expect(page).toHaveURL(/\/data-transfer\/imports\/[0-9a-f-]+/u);

  const lostFilename = `${token}-响应丢失.csv`;
  await page.getByRole('link', { name: '返回导入历史' }).click();
  await page.route(
    '**/api/data-transfers/imports',
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await chooseFile(page, lostFilename, quotedRow(['具体案例', `${token}已提交但响应丢失`]));
  await page.getByRole('button', { name: '开始导入' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: lostFilename })).toBeVisible();
});

test('import history page and detail tab/page are URL-restorable', async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = `E2E历史${Date.now()}`;
  for (let index = 0; index < 51; index += 1) {
    await uploadCsv(
      request,
      `${token}-${String(index).padStart(2, '0')}.csv`,
      quotedRow(['具体案例', `${token}案例${index}`]),
    );
  }
  const detailCsv = Array.from({ length: 51 }, (_, index) =>
    quotedRow(['原子事件', `${token}明细${String(index).padStart(2, '0')}`]),
  ).join('');
  const detail = await uploadCsv(request, `${token}-分页明细.csv`, detailCsv);

  await page.goto('/data-transfer?tab=import&page=2');
  await expect(page.getByText(/第 2\/2 页/u)).toBeVisible();
  await page.goto(
    `/data-transfer/imports/${detail.batch.id}?tab=events&eventPage=2&casePage=1&relationPage=1&relationCasePage=1`,
  );
  await expect(page.getByText(/第 2\/2 页/u)).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/tab=events&eventPage=2/u);
  await expect(page.getByText(`${token}明细50`)).toBeVisible();
});
