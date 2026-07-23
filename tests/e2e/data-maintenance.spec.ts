import { expect, test, type APIRequestContext } from '@playwright/test';

const apiBase = 'http://127.0.0.1:3000/api';

interface EventRecord {
  id: string;
  name: string;
}

interface RelationRecord {
  id: string;
}

interface CaseRecord {
  id: string;
  content: string;
}

interface DataCheckLatest {
  task: { status: 'never_run' | 'running' | 'succeeded' | 'failed' };
  snapshot: { snapshotId: string } | null;
}

async function createEvent(request: APIRequestContext, name: string, aliases: string[] = []) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases, keywords: [] },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as EventRecord;
}

async function createCase(request: APIRequestContext, content: string) {
  const response = await request.post(`${apiBase}/cases`, { data: { content } });
  expect(response.status()).toBe(201);
  return (await response.json()) as CaseRecord;
}

async function createRelation(
  request: APIRequestContext,
  causeEventId: string,
  effectEventId: string,
  caseId?: string,
) {
  const response = await request.post(`${apiBase}/relations`, {
    data: {
      causeEventId,
      effectEventId,
      confidence: 50,
      description: null,
      caseSelections: caseId ? [{ type: 'existing', caseId }] : [],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as RelationRecord;
}

async function waitForSuccessfulCheck(request: APIRequestContext): Promise<DataCheckLatest> {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBase}/data-checks/latest`);
      expect(response.status()).toBe(200);
      return (await response.json()) as DataCheckLatest;
    })
    .toMatchObject({ task: { status: 'succeeded' }, snapshot: { snapshotId: expect.any(String) } });

  return (await (await request.get(`${apiBase}/data-checks/latest`)).json()) as DataCheckLatest;
}

test('deletion workflows protect linked events and preserve linked main records', async ({
  page,
  request,
}) => {
  const token = `E2E 删除维护 ${Date.now()}`;
  const cause = await createEvent(request, `${token} 原因`);
  const effect = await createEvent(request, `${token} 结果`);
  const linkedCase = await createCase(request, `${token} 关联案例`);
  await createRelation(request, cause.id, effect.id, linkedCase.id);

  await page.goto(`/events?q=${encodeURIComponent(token)}`);
  const eventRow = page.getByRole('row').filter({ hasText: cause.name });
  await eventRow.getByRole('button', { name: '删除' }).click();
  const dialog = page.getByRole('dialog', { name: '删除原子事件' });
  await expect(dialog).toContainText('必须先删除相关因果关系');
  await expect(dialog).not.toContainText(cause.name);
  await expect(dialog).not.toContainText(effect.name);
  await expect(dialog).not.toContainText(linkedCase.content);
  await expect(dialog).not.toContainText(/\d+\s*条/u);
  await dialog.getByRole('link', { name: '查看相关因果关系' }).click();
  await expect(page).toHaveURL(new RegExp(`/relations\\?eventId=${cause.id}$`));

  const relationRow = page.getByRole('row').filter({ hasText: effect.name });
  await relationRow.getByRole('button', { name: '删除' }).click();
  const relationDialog = page.getByRole('dialog', { name: '删除因果关系' });
  await expect(relationDialog).toContainText('不会删除事件或案例');
  await expect(relationDialog).not.toContainText(cause.name);
  await expect(relationDialog).not.toContainText(effect.name);
  await expect(relationDialog).not.toContainText(linkedCase.content);
  await expect(relationDialog).not.toContainText(/\d+\s*条/u);
  await relationDialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('row').filter({ hasText: effect.name })).toHaveCount(0);

  expect((await request.get(`${apiBase}/events/${cause.id}`)).status()).toBe(200);
  expect((await request.get(`${apiBase}/events/${effect.id}`)).status()).toBe(200);
  expect((await request.get(`${apiBase}/cases/${linkedCase.id}`)).status()).toBe(200);

  await page.goto(`/events?q=${encodeURIComponent(token)}&orphan=true&page=1`);
  const nowOrphanedRow = page.getByRole('row').filter({ hasText: cause.name });
  await nowOrphanedRow.getByRole('button', { name: '删除' }).click();
  await page
    .getByRole('dialog', { name: '删除原子事件' })
    .getByRole('button', { name: '确认删除' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/events\\?q=${encodeURIComponent(token)}&orphan=true&page=1$`),
  );
  await expect(page.getByRole('row').filter({ hasText: cause.name })).toHaveCount(0);
  expect((await request.get(`${apiBase}/events/${cause.id}`)).status()).toBe(404);
});

test('case deletion preserves associated relations', async ({ page, request }) => {
  const token = `E2E 案例删除 ${Date.now()}`;
  const cause = await createEvent(request, `${token} 原因`);
  const effect = await createEvent(request, `${token} 结果`);
  const linkedCase = await createCase(request, `${token} 关联案例`);
  const relation = await createRelation(request, cause.id, effect.id, linkedCase.id);

  await page.goto(`/cases?q=${encodeURIComponent(token)}`);
  await page
    .getByRole('row')
    .filter({ hasText: linkedCase.content })
    .getByRole('button', { name: '删除' })
    .click();
  const dialog = page.getByRole('dialog', { name: '删除具体案例' });
  await expect(dialog).toContainText('不会删除因果关系');
  await expect(dialog).not.toContainText(cause.name);
  await expect(dialog).not.toContainText(effect.name);
  await expect(dialog).not.toContainText(linkedCase.content);
  await expect(dialog).not.toContainText(/\d+\s*条/u);
  await dialog.getByRole('button', { name: '确认删除' }).click();

  await expect(page.getByRole('row').filter({ hasText: linkedCase.content })).toHaveCount(0);
  expect((await request.get(`${apiBase}/cases/${linkedCase.id}`)).status()).toBe(404);
  expect((await request.get(`${apiBase}/relations/${relation.id}`)).status()).toBe(200);
});

test('data maintenance starts only on request, retains snapshots, and rediscovers handled warnings', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const token = `E2E 数据检查 ${Date.now()}`;
  const target = await createEvent(request, `${token} 目标`);
  await createEvent(request, `${token} 别名来源`, [target.name]);
  const otherTarget = await createEvent(request, `${token} 另一目标`);
  await createEvent(request, `${token} 另一别名来源`, [otherTarget.name]);

  const before = await request.get(`${apiBase}/data-checks/latest`);
  expect(before.status()).toBe(200);
  const prior = (await before.json()) as DataCheckLatest;

  await page.goto('/maintenance');
  await expect(page.getByRole('button', { name: '检查数据' })).toBeVisible();
  const afterVisit = (await (
    await request.get(`${apiBase}/data-checks/latest`)
  ).json()) as DataCheckLatest;
  expect(afterVisit.task.status).toBe(prior.task.status);

  await page.getByRole('button', { name: '检查数据' }).click();
  await expect(page.getByText(/数据检查进行中|检查完成/u)).toBeVisible();
  const firstSnapshot = await waitForSuccessfulCheck(request);
  expect(firstSnapshot.snapshot).not.toBeNull();

  await page.getByRole('link', { name: '系统状态' }).click();
  await page.getByRole('link', { name: '数据维护' }).click();
  await expect(page.getByText('最近成功检查')).toBeVisible();
  await page.reload();
  await expect(page.getByText('最近成功检查')).toBeVisible();
  await expect(page.locator('.data-check-table thead th')).toHaveCount(3);

  await page.getByRole('link', { name: '孤立原子事件' }).click();
  await expect(page).toHaveURL(/\/events\?orphan=true$/);
  await page.goto('/maintenance');

  const warningRows = page
    .locator('.data-check-table tbody tr')
    .filter({ hasText: '一个事件的别名与另一个事件的标准名称相同' });
  const targetWarning = warningRows.filter({
    has: page.locator(`a[href="/events/${target.id}"]`),
  });
  const otherWarning = warningRows.filter({
    has: page.locator(`a[href="/events/${otherTarget.id}"]`),
  });
  await expect(targetWarning).toHaveCount(1);
  await expect(otherWarning).toHaveCount(1);
  await targetWarning.getByRole('button', { name: '手动处理' }).click();
  await expect(targetWarning.getByText('已处理')).toBeVisible();
  await expect(otherWarning.getByRole('button', { name: '手动处理' })).toBeVisible();

  const secondStart = await request.post(`${apiBase}/data-checks`);
  expect(secondStart.status()).toBe(202);
  const secondSnapshot = await waitForSuccessfulCheck(request);
  expect(secondSnapshot.snapshot?.snapshotId).not.toBe(firstSnapshot.snapshot?.snapshotId);

  await page.reload();
  const rediscoveredTarget = page
    .locator('.data-check-table tbody tr')
    .filter({ hasText: '一个事件的别名与另一个事件的标准名称相同' })
    .filter({ has: page.locator(`a[href="/events/${target.id}"]`) });
  await expect(rediscoveredTarget).toHaveCount(1);
  await expect(rediscoveredTarget.getByRole('button', { name: '手动处理' })).toBeVisible();
});
