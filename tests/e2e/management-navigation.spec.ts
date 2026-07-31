import { expect, test } from './support/fixtures';

const relationId = '00000000-0000-4000-8100-000000000001';
const caseId = '00000000-0000-4000-8200-000000000001';
const eventId = '00000000-0000-4000-8000-000000000001';

test('management pages expose concise expansion, editing, and detail navigation', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/events');
  const firstEventRow = page.locator('.event-table tbody tr').first();
  await expect(firstEventRow.getByRole('link', { name: '编辑' })).toHaveAttribute(
    'href',
    /\/events\/[0-9a-f-]+\/edit$/,
  );

  const readDetailHeading = () =>
    page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>('.detail-heading')!;
      const title = heading.querySelector<HTMLElement>('h1')!.getBoundingClientRect();
      const button = heading.querySelector<HTMLElement>('.button')!.getBoundingClientRect();
      return {
        label: heading.querySelector<HTMLElement>('.detail-label')!.textContent,
        headingTop: heading.getBoundingClientRect().top,
        titleTop: title.top,
        buttonTop: button.top,
        buttonHeight: button.height,
      };
    });

  await page.goto(`/events/${eventId}`);
  await expect(page.getByRole('heading', { name: '政策利率上升' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '关联的因果关系' })).toBeVisible();
  await expect(page.getByRole('link', { name: /政策利率上升.*企业融资成本上升/ })).toHaveAttribute(
    'href',
    `/relations/${relationId}`,
  );
  const eventHeading = await readDetailHeading();

  await page.goto('/relations');
  const firstRelationRow = page.locator('.relation-table tbody tr').first();
  await expect(firstRelationRow.getByRole('button', { name: '展开' })).toBeVisible();
  await expect(firstRelationRow.getByRole('link', { name: '编辑' })).toHaveAttribute(
    'href',
    /\/relations\/[0-9a-f-]+\/edit$/,
  );
  await expect(firstRelationRow.getByRole('link', { name: '查看因果关系详情' })).toHaveAttribute(
    'href',
    /\/relations\/[0-9a-f-]+$/,
  );
  await firstRelationRow.getByRole('button', { name: '展开' }).click();
  await expect(page.getByText('关系说明', { exact: true })).toBeVisible();
  await expect(
    page.locator('.relation-inline-cases').getByText('具体案例', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('创建时间', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '编辑关系' })).toHaveCount(0);

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).not.toHaveURL(/expanded=/);

  await page.goto(`/relations/${relationId}`);
  await expect(page.getByRole('heading', { name: /政策利率上升.*企业融资成本上升/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '编辑因果关系' })).toHaveAttribute(
    'href',
    `/relations/${relationId}/edit`,
  );
  await expect(page.getByRole('link', { name: '政策利率上升', exact: true })).toHaveAttribute(
    'href',
    '/events/00000000-0000-4000-8000-000000000001',
  );
  const relationHeading = await readDetailHeading();

  await page.goto(`/cases/${caseId}`);
  const relationLink = page.getByRole('link', { name: /政策利率上升.*企业融资成本上升/ });
  await expect(relationLink).toHaveAttribute('href', `/relations/${relationId}`);
  const caseHeading = await readDetailHeading();

  expect([eventHeading.label, relationHeading.label, caseHeading.label]).toEqual([
    '原子事件',
    '因果关系',
    '案例内容',
  ]);
  expect(eventHeading).toMatchObject({
    headingTop: relationHeading.headingTop,
    titleTop: relationHeading.titleTop,
    buttonTop: relationHeading.buttonTop,
    buttonHeight: relationHeading.buttonHeight,
  });
  expect(caseHeading).toMatchObject({
    headingTop: relationHeading.headingTop,
    titleTop: relationHeading.titleTop,
    buttonTop: relationHeading.buttonTop,
    buttonHeight: relationHeading.buttonHeight,
  });

  await page.goto(`/relations/${relationId}`);
  await page.screenshot({
    path: testInfo.outputPath('relation-detail-1280x720.png'),
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
