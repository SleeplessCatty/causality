import type { APIRequestContext, Download, Page } from '@playwright/test';

import { expect, test } from './support/fixtures';

import { apiBase } from './support/urls';

async function createEvent(request: APIRequestContext, name: string) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases: [], keywords: [] },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function createCase(request: APIRequestContext, content: string) {
  const response = await request.post(`${apiBase}/cases`, { data: { content } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; content: string };
}

async function createRelation(
  request: APIRequestContext,
  causeEventId: string,
  effectEventId: string,
  caseId: string,
) {
  const response = await request.post(`${apiBase}/relations`, {
    data: {
      causeEventId,
      effectEventId,
      confidence: 65,
      description: '用于导出回归',
      caseSelections: [{ type: 'existing', caseId }],
    },
  });
  expect(response.status()).toBe(201);
}

async function selectCandidate(page: Page, name: string): Promise<void> {
  const input = page.getByRole('combobox', { name: '搜索起始原子事件' });
  await input.fill(name);
  await expect(page.getByRole('listbox', { name: '起始事件候选项' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
}

async function confirmAndCaptureDownload(page: Page): Promise<Download> {
  await page.getByRole('button', { name: '数据导出' }).click();
  const dialog = page.getByRole('dialog', { name: '确认导出' });
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出' }).click();
  return downloadPromise;
}

test('filtered export supports keyboard candidates, removable chips, directions, depths, and round-trip CSV', async ({
  page,
  request,
}) => {
  const token = `E2E导出${Date.now()}`;
  const upstream = await createEvent(request, `${token}上游`);
  const center = await createEvent(request, `${token}中心`);
  const downstream = await createEvent(request, `${token}下游`);
  const linkedCase = await createCase(request, `${token}案例包含,逗号与"引号"`);
  await createRelation(request, upstream.id, center.id, linkedCase.id);
  await createRelation(request, center.id, downstream.id, linkedCase.id);

  await page.goto('/data-transfer?tab=export&page=1');
  await page.getByRole('button', { name: '筛选导出' }).click();
  await selectCandidate(page, center.name);
  await selectCandidate(page, upstream.name);
  const chips = page.getByRole('list', { name: '已选起始原子事件' });
  await expect(chips.getByRole('listitem')).toHaveCount(2);
  await chips.getByRole('button', { name: `移除起始原子事件：${upstream.name}` }).click();
  await expect(chips.getByRole('listitem')).toHaveCount(1);

  const direction = page.getByRole('button', { name: '遍历方向' });
  await direction.click();
  await page.getByRole('option', { name: '下游' }).click();
  await direction.click();
  await page.getByRole('option', { name: '上游' }).click();
  await direction.click();
  await page.getByRole('option', { name: '双向' }).click();
  const depth = page.getByRole('button', { name: '遍历深度' });
  await depth.click();
  await page.getByRole('option', { name: '2', exact: true }).click();

  await page.getByRole('button', { name: '数据导出' }).click();
  const dialog = page.getByRole('dialog', { name: '确认导出' });
  await expect(dialog).toContainText('原子事件');
  await expect(dialog).toContainText('3');
  await expect(dialog).toContainText('因果关系');
  await expect(dialog).toContainText('2');
  const filteredDownloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出' }).click();
  const filteredDownload = await filteredDownloadPromise;
  const filteredPath = await filteredDownload.path();
  expect(filteredPath).not.toBeNull();
  const csv = await import('node:fs/promises').then((fs) => fs.readFile(filteredPath!, 'utf8'));
  expect(csv).toContain(`"${center.name}"`);
  expect(csv).toContain(`"${linkedCase.content.replaceAll('"', '""')}"`);

  const reimport = await request.post(`${apiBase}/data-transfers/imports`, {
    multipart: {
      file: {
        name: `${token}-回灌.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(reimport.status()).toBe(201);
  expect(await reimport.json()).toMatchObject({
    batch: {
      counts: {
        event: { created: 0, reused: 3 },
        case: { created: 0, reused: 1 },
        relation: { created: 0, reused: 2 },
        relationCase: { created: 0, reused: 2 },
      },
    },
  });
});

test('full export confirms counts and saves a CSV file', async ({ page }) => {
  await page.goto('/data-transfer?tab=export&page=1');
  const download = await confirmAndCaptureDownload(page);
  expect(download.suggestedFilename()).toMatch(/^causality-full-.*\.csv$/u);
  expect(await download.path()).not.toBeNull();
  await expect(page.getByText('下载已开始')).toHaveCount(0);
});
