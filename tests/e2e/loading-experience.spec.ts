import { expect, test } from './support/fixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const legacyLoadingText = [
      '正在检查登录状态',
      '正在加载页面',
      '加载事件',
      '加载案例',
      '加载因果关系',
    ];
    const seen = new Set<string>();
    const inspect = () => {
      const text = document.body?.innerText ?? '';
      for (const value of legacyLoadingText) {
        if (text.includes(value)) seen.add(value);
      }
      (
        window as Window & { __causalityLegacyLoadingText?: string[] }
      ).__causalityLegacyLoadingText = [...seen];
    };
    new MutationObserver(inspect).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
});

test('slow event loading uses a stable list skeleton without legacy loading text', async ({
  page,
}) => {
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/events',
    async (route) => {
      await requestGate;
      await route.continue();
    },
  );

  await page.goto('/events');
  const skeleton = page.locator('[data-skeleton-variant="list"]:not(.page-skeleton--hidden)');
  await expect(skeleton).toBeVisible();
  const skeletonBox = await skeleton.boundingBox();

  releaseRequest();
  const finalPage = page.locator('.event-list-page');
  await expect(finalPage).toBeVisible();
  const finalBox = await finalPage.boundingBox();

  expect(skeletonBox).not.toBeNull();
  expect(finalBox).not.toBeNull();
  expect(Math.abs(finalBox!.x - skeletonBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(finalBox!.width - skeletonBox!.width)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __causalityLegacyLoadingText?: string[] })
          .__causalityLegacyLoadingText ?? [],
    ),
  ).toEqual([]);
});

test('a normal event page load never exposes legacy loading copy', async ({ page }) => {
  await page.goto('/events');
  await expect(page.locator('.event-list-page')).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        (window as Window & { __causalityLegacyLoadingText?: string[] })
          .__causalityLegacyLoadingText ?? [],
    ),
  ).toEqual([]);
});
