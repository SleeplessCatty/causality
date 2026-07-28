import { expect, test } from '@playwright/test';

const batchId = '10000000-0000-4000-8000-000000000001';
const planId = '20000000-0000-4000-8000-000000000001';
const topic = '跨区域能源供应变化对工业成本与商品价格的连续传导分析';
const counts = {
  eventCreated: 2,
  eventReused: 1,
  eventUpdated: 1,
  caseCreated: 1,
  caseReused: 0,
  relationCreated: 1,
  relationReused: 0,
  relationCaseCreated: 1,
  confidenceChanged: 1,
};

test('AI import history and read-only detail preserve navigation and category state', async ({
  page,
}, testInfo) => {
  await page.route('**/api/ai-captures/history?page=2', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: batchId,
            planId,
            topic,
            planVersion: 2,
            clientName: 'E2E AI Client',
            completedAt: '2026-07-28T06:00:00.000Z',
            counts,
          },
        ],
        page: 2,
        pageSize: 50,
        totalItems: 51,
        totalPages: 2,
      },
    });
  });
  await page.route(`**/api/ai-captures/history/${batchId}`, async (route) => {
    await route.fulfill({
      json: {
        id: batchId,
        planId,
        topic,
        planVersion: 2,
        clientName: 'E2E AI Client',
        completedAt: '2026-07-28T06:00:00.000Z',
        counts,
      },
    });
  });
  await page.route(`**/api/ai-captures/history/${batchId}/records?*`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const type = requestUrl.searchParams.get('type');
    const pageNumber = Number(requestUrl.searchParams.get('page'));
    const details: Record<string, Record<string, unknown>> = {
      event: { name: `${topic}中的能源供给减少事件` },
      case: { content: '2026年某地区能源现货供应量下降，价格随后持续上升。' },
      relation: {
        causeEventId: '能源供给减少',
        effectEventId: '能源价格上升',
        description: '供给减少推动价格上升',
      },
      relation_case: { relationRef: 'relation-1', caseRef: 'case-1' },
      confidence: {
        relationRef: 'relation-1',
        oldConfidence: 10,
        newConfidence: 19,
        oldCaseCount: 0,
        newCaseCount: 1,
      },
    };
    await route.fulfill({
      json: {
        items: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            sequence: 1,
            recordType: type,
            action: type === 'confidence' ? 'changed' : 'created',
            primaryRecordId: '40000000-0000-4000-8000-000000000001',
            relatedRecordId: null,
            detail: details[type ?? 'event'],
          },
        ],
        page: pageNumber,
        pageSize: 50,
        totalItems: pageNumber === 2 ? 51 : 1,
        totalPages: pageNumber === 2 ? 2 : 1,
      },
    });
  });

  await page.goto('/data-transfer?tab=aiHistory&page=2');
  await expect(page.getByRole('tab', { name: 'AI 导入历史' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(topic)).toBeVisible();
  await page.getByText(topic).focus();
  await expect(page.getByRole('tooltip')).toHaveText(topic);

  await page.getByRole('link', { name: '查看 AI 导入详情' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/data-transfer/ai-imports/${batchId}\\?tab=events`, 'u'),
  );
  await expect(page.getByRole('heading', { name: topic })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText([
    '原子事件',
    '具体案例',
    '因果关系',
    '案例关联',
    '置信度变化',
  ]);
  await page.getByRole('tab', { name: '置信度变化' }).click();
  await expect(page.getByText('relation-1：10% → 19%（案例 0 → 1）')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('ai-import-detail-1280x720.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: '返回 AI 导入历史' }).click();
  await expect(page).toHaveURL('/data-transfer?tab=aiHistory&page=2');
  await expect(page.locator(`#list-record-${batchId}`)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('ai-import-history-1280x720.png'),
    fullPage: true,
  });
});
