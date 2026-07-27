import { expect, test } from '@playwright/test';

import { apiBase } from './support/urls';

test('boundary-length business text stays contained, inspectable, and editable', async ({
  page,
  request,
}) => {
  const uniquePrefix = `UX03${Date.now()}`;
  const name = (uniquePrefix + 'N'.repeat(50)).slice(0, 50);
  const alias = 'A'.repeat(80);
  const keyword = 'K'.repeat(50);
  const description = 'D'.repeat(2_000);
  const created = await request.post(`${apiBase}/events`, {
    data: { name, description, aliases: [alias], keywords: [keyword] },
  });
  expect(created.status()).toBe(201);
  const event = (await created.json()) as { id: string };

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/events/${event.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mainOverflow:
        document.querySelector<HTMLElement>('.product-main')!.scrollWidth -
        document.querySelector<HTMLElement>('.product-main')!.clientWidth,
      gridOverflow:
        document.querySelector<HTMLElement>('.event-detail-grid')!.scrollWidth -
        document.querySelector<HTMLElement>('.event-detail-grid')!.clientWidth,
    }));
    expect(geometry).toEqual({ pageOverflow: 0, mainOverflow: 0, gridOverflow: 0 });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  const descriptionTrigger = page.locator('.event-detail-grid .detail-wide .overflow-text');
  await descriptionTrigger.hover();
  await page.waitForTimeout(2_050);
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText(description);
  const tooltipGeometry = await tooltip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: box.width,
      maxHeight: style.maxHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollable: element.scrollHeight > element.clientHeight,
      contained:
        box.left >= 16 &&
        box.top >= 16 &&
        box.right <= innerWidth - 16 &&
        box.bottom <= innerHeight - 16,
    };
  });
  expect(tooltipGeometry).toEqual({
    width: 360,
    maxHeight: '240px',
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollable: true,
    contained: true,
  });
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);

  await page.goto(`/events/${event.id}/edit`);
  const nameInput = page.getByRole('textbox', { name: '标准名称' });
  await nameInput.focus();
  await nameInput.press('End');
  expect(await nameInput.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(50);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const descriptionInput = page.getByRole('textbox', { name: '事件说明' });
  expect(await descriptionInput.inputValue()).toBe(description);
  expect(await descriptionInput.evaluate((input) => getComputedStyle(input).overflowWrap)).toBe(
    'anywhere',
  );

  await page.goto('/relations/new');
  await page.getByRole('combobox', { name: '原因事件' }).fill(uniquePrefix);
  const candidate = page.getByRole('option', { name });
  await expect(candidate).toBeVisible();
  expect((await candidate.boundingBox())?.height).toBe(36);
  expect(await candidate.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  await candidate.hover();
  await page.waitForTimeout(2_050);
  await expect(page.getByRole('tooltip')).toHaveText(name);
});
