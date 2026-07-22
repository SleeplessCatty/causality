import { expect, test, type APIRequestContext } from '@playwright/test';

const apiBase = 'http://127.0.0.1:3000/api';

async function createEvent(request: APIRequestContext, name: string) {
  const response = await request.post(`${apiBase}/events`, {
    data: { name, description: null, aliases: [], keywords: [] },
  });
  expect(response.status()).toBe(201);
}

async function createCase(request: APIRequestContext, content: string) {
  const response = await request.post(`${apiBase}/cases`, { data: { content } });
  expect(response.status()).toBe(201);
}

test('relation selectors load every page and keep the new-case action above the input', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}`.slice(-7);
  const eventPrefix = `E2ECAND-${suffix}`;
  const casePrefix = `E2ECASE-${suffix}`;
  const laterEvent = `${eventPrefix}-100`;
  const laterCase = `${casePrefix}-000`;

  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      createEvent(request, `${eventPrefix}-${String(index).padStart(3, '0')}`),
    ),
  );
  await createCase(request, laterCase);
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      createCase(request, `${casePrefix}-${String(index + 1).padStart(3, '0')}`),
    ),
  );

  await page.goto('/relations/new');
  const causeInput = page.getByRole('combobox', { name: '原因事件' });
  const eventNextPage = page.waitForResponse(
    (response) =>
      response.url().includes('/api/events/candidates?') && response.url().includes('cursor='),
  );
  await causeInput.fill(eventPrefix);
  await eventNextPage;
  await causeInput.press('End');
  await causeInput.press('Enter');
  await expect(causeInput).toHaveValue(laterEvent);

  await page.getByRole('button', { name: '添加案例' }).click();
  const caseInput = page.getByRole('combobox', { name: '具体案例 1' });
  const caseNextPage = page.waitForResponse(
    (response) =>
      response.url().includes('/api/cases/candidates?') && response.url().includes('cursor='),
  );
  await caseInput.fill(casePrefix);
  await expect(page.getByRole('option', { name: `创建新案例：${casePrefix}` })).toBeVisible();
  expect(await page.getByRole('option').first().textContent()).toBe(`创建新案例：${casePrefix}`);
  await caseNextPage;

  const caseListbox = page.getByRole('listbox', { name: '具体案例 1 候选项' });
  const [inputBox, listboxBox] = await Promise.all([
    caseInput.boundingBox(),
    caseListbox.boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(listboxBox).not.toBeNull();
  if (inputBox && listboxBox)
    expect(listboxBox.y + listboxBox.height).toBeLessThanOrEqual(inputBox.y + 1);

  await caseInput.press('End');
  await caseInput.press('Enter');
  await expect(caseInput).toHaveValue(laterCase);

  await page.getByRole('button', { name: '添加案例' }).click();
  await page.getByRole('combobox', { name: '具体案例 2' }).fill(casePrefix);
  await page.screenshot({
    path: testInfo.outputPath('relation-case-dropdown-above.png'),
    fullPage: true,
  });
});
