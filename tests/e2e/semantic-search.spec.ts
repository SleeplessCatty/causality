import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';

type Entity = 'events' | 'relations' | 'cases';

interface RecordedListRequest {
  entity: Entity;
  page: number;
  query: string;
  searchMode: string | null;
}

interface SemanticListControls {
  requests: RecordedListRequest[];
  failure: Partial<Record<Entity, string>>;
  notice: Partial<Record<Entity, 'updating' | 'incomplete'>>;
}

const updatedAt = '2026-07-23T10:00:00.000Z';

function listBody(
  entity: Entity,
  page: number,
  semanticIndexNotice: 'updating' | 'incomplete' | null,
) {
  const metadata = {
    page,
    pageSize: 50,
    totalItems: 101,
    totalPages: 3,
    semanticIndexNotice,
  };
  if (entity === 'events') {
    return {
      ...metadata,
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: `政策事件（第 ${page} 页）`,
          aliases: ['政策变化'],
          keywords: ['政策'],
          relationCount: 2,
          updatedAt,
        },
      ],
    };
  }
  if (entity === 'relations') {
    return {
      ...metadata,
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          causeEvent: {
            id: '33333333-3333-4333-8333-333333333333',
            name: `政策收紧（第 ${page} 页）`,
          },
          effectEvent: {
            id: '44444444-4444-4444-8444-444444444444',
            name: '市场流动性下降',
          },
          confidence: 70,
          caseCount: 3,
          updatedAt,
        },
      ],
    };
  }
  return {
    ...metadata,
    items: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        content: `政策案例（第 ${page} 页）`,
        relationCount: 1,
        updatedAt,
      },
    ],
  };
}

async function mockListApis(page: Page): Promise<SemanticListControls> {
  const controls: SemanticListControls = {
    requests: [],
    failure: {},
    notice: {},
  };

  await page.route(/\/api\/(events|relations|cases)\?/u, async (route) => {
    const url = new URL(route.request().url());
    const entity = url.pathname.slice('/api/'.length) as Entity;
    const request = {
      entity,
      page: Number(url.searchParams.get('page') ?? '1'),
      query: url.searchParams.get('q') ?? '',
      searchMode: url.searchParams.get('searchMode'),
    };
    controls.requests.push(request);

    const failureCode = controls.failure[entity];
    if (request.searchMode === 'enhanced' && failureCode) {
      await route.fulfill({
        status: 503,
        json: { code: failureCode, message: '内部语义错误详情' },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: listBody(
        entity,
        request.page,
        request.searchMode === 'enhanced' ? (controls.notice[entity] ?? null) : null,
      ),
    });
  });

  return controls;
}

test('all three list pages run ordinary search before an explicit enhanced search', async ({
  page,
}) => {
  const controls = await mockListApis(page);
  const pages = [
    { entity: 'events' as const, path: '/events', heading: '原子事件' },
    { entity: 'relations' as const, path: '/relations', heading: '因果关系' },
    { entity: 'cases' as const, path: '/cases', heading: '具体案例' },
  ];

  for (const target of pages) {
    const requestStart = controls.requests.length;
    await page.goto(`${target.path}?q=${encodeURIComponent('政策')}`);
    await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
    await expect.poll(() => controls.requests.length).toBeGreaterThan(requestStart);
    expect(controls.requests.at(-1)).toMatchObject({
      entity: target.entity,
      query: '政策',
      searchMode: null,
    });

    await page.getByRole('button', { name: '增强查询' }).click();
    await expect
      .poll(() =>
        controls.requests.some(
          (request) => request.entity === target.entity && request.searchMode === 'enhanced',
        ),
      )
      .toBe(true);
    await expect(page.getByRole('button', { name: '增强查询' })).toBeEnabled();
  }
});

test('enhanced pagination and refresh stay active while text changes return to ordinary search', async ({
  page,
}) => {
  const controls = await mockListApis(page);
  await page.goto(`/cases?q=${encodeURIComponent('政策')}&page=2`);
  await expect(page.getByText('政策案例（第 2 页）')).toBeVisible();

  await page.getByRole('button', { name: '增强查询' }).click();
  await expect(page.getByText('政策案例（第 1 页）')).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('政策案例（第 2 页）')).toBeVisible();
  expect(
    controls.requests.some(
      (request) =>
        request.entity === 'cases' && request.page === 2 && request.searchMode === 'enhanced',
    ),
  ).toBe(true);

  await page.getByRole('searchbox', { name: '搜索案例' }).fill('新政策');
  await expect(page).toHaveURL(/q=%E6%96%B0%E6%94%BF%E7%AD%96/u);
  await expect
    .poll(() =>
      controls.requests.some(
        (request) =>
          request.entity === 'cases' && request.query === '新政策' && request.searchMode === null,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: '增强查询' }).click();
  await expect.poll(() => controls.requests.at(-1)?.searchMode).toBe('enhanced');
  const reloadStart = controls.requests.length;
  await page.reload();
  await expect.poll(() => controls.requests.length).toBeGreaterThan(reloadStart);
  expect(controls.requests.at(-1)?.searchMode).toBe('enhanced');
});

test('enhanced failures retain ordinary rows and queryable index states show notices', async ({
  page,
}) => {
  const controls = await mockListApis(page);
  controls.failure.events = 'SEMANTIC_INDEX_FAILED';
  await page.goto(`/events?q=${encodeURIComponent('政策')}`);
  await expect(page.getByText('政策事件（第 1 页）')).toBeVisible();
  await page.getByRole('button', { name: '增强查询' }).click();

  await expect(page.getByRole('alert')).toContainText('语义索引生成失败');
  await expect(page.getByRole('link', { name: '前往参数配置' })).toHaveAttribute(
    'href',
    '/settings',
  );
  await expect(page.getByText('政策事件（第 1 页）')).toBeVisible();
  await expect(page.getByText('无法加载事件')).toHaveCount(0);

  controls.notice.relations = 'updating';
  await page.goto(`/relations?q=${encodeURIComponent('政策')}`);
  await page.getByRole('button', { name: '增强查询' }).click();
  await expect(page.getByRole('status')).toContainText(
    '语义索引尚在同步，结果可能暂不包含最新修改',
  );

  controls.notice.cases = 'incomplete';
  await page.goto(`/cases?q=${encodeURIComponent('政策')}`);
  await page.getByRole('button', { name: '增强查询' }).click();
  await expect(page.getByRole('status')).toContainText('语义索引不完整，结果可能缺少部分记录');
  await expect(page.getByRole('link', { name: '前往参数配置' })).toHaveAttribute(
    'href',
    '/settings',
  );
});
