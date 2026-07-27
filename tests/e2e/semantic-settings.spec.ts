import type {
  SemanticLifecycleSnapshot,
  SemanticModelCode,
  SemanticModelLifecycle,
} from '@causality/contracts';
import { expect, test, type Page } from '@playwright/test';

const taskId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-07-23T10:00:00.000Z';

function model(
  overrides: Partial<SemanticModelLifecycle> & Pick<SemanticModelLifecycle, 'modelCode' | 'label'>,
): SemanticModelLifecycle {
  const { modelCode, label, ...rest } = overrides;
  return {
    modelCode,
    label,
    description: '用于验证模型生命周期界面',
    languageLabel: '中文、英文及中英混排',
    dimensions: 384,
    expectedDownloadBytes: 135_392_857,
    threshold: 70,
    dedupeThreshold: 100,
    downloadedAt: null,
    fileState: 'not_downloaded',
    role: 'inactive',
    stage: 'not_downloaded',
    availableForEnhancedSearch: false,
    allowedActions: ['download_and_use'],
    failure: null,
    ...rest,
  };
}

function baseLifecycle(): SemanticLifecycleSnapshot {
  return {
    currentModelCode: null,
    index: {
      status: 'empty',
      processedItems: 0,
      totalItems: 0,
      pendingItems: 0,
      failedItems: 0,
      availableForEnhancedSearch: false,
      failure: null,
      updatedAt: null,
    },
    models: [
      model({
        modelCode: 'multilingual-e5-small',
        label: '轻量快速',
      }),
      model({
        modelCode: 'bge-m3',
        label: '质量优先',
        dimensions: 1024,
        expectedDownloadBytes: 585_565_019,
        fileState: 'downloaded',
        stage: 'downloaded',
        downloadedAt: timestamp,
        allowedActions: ['use'],
      }),
    ],
    operation: null,
    worker: {
      status: 'online',
      modelState: 'idle',
      loadedModelCode: null,
      checkedAt: timestamp,
    },
    pollAfterMs: null,
    updatedAt: timestamp,
  };
}

async function mockSemanticApi(
  page: Page,
  initial: SemanticLifecycleSnapshot,
): Promise<{ read(): SemanticLifecycleSnapshot }> {
  let lifecycle = initial;
  await page.route('**/api/semantic/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === 'GET' && path === '/api/semantic/lifecycle') {
      await route.fulfill({ status: 200, json: lifecycle });
      return;
    }
    const thresholdMatch = path.match(/^\/api\/semantic\/models\/([^/]+)\/threshold$/u);
    if (request.method() === 'PATCH' && thresholdMatch) {
      const threshold = (request.postDataJSON() as { threshold: number }).threshold;
      lifecycle = {
        ...lifecycle,
        models: lifecycle.models.map((item) =>
          item.modelCode === thresholdMatch[1] ? { ...item, threshold } : item,
        ),
      };
      await route.fulfill({ status: 200, json: lifecycle });
      return;
    }
    const useMatch = path.match(/^\/api\/semantic\/models\/([^/]+)\/use$/u);
    if (request.method() === 'POST' && useMatch) {
      const modelCode = useMatch[1] as SemanticModelCode;
      const isDownload =
        lifecycle.models.find((item) => item.modelCode === modelCode)?.fileState !== 'downloaded';
      lifecycle = {
        ...lifecycle,
        currentModelCode: modelCode,
        index: {
          ...lifecycle.index,
          status: isDownload ? 'waiting_model' : 'building',
          processedItems: isDownload ? 0 : 120,
          totalItems: isDownload ? 0 : 1_000,
        },
        models: lifecycle.models.map((item) => ({
          ...item,
          role: item.modelCode === modelCode ? ('current' as const) : ('inactive' as const),
          stage:
            item.modelCode === modelCode
              ? isDownload
                ? ('downloading' as const)
                : ('building' as const)
              : item.fileState === 'downloaded'
                ? ('downloaded' as const)
                : ('not_downloaded' as const),
          fileState:
            item.modelCode === modelCode && isDownload ? ('downloading' as const) : item.fileState,
          allowedActions: [],
        })),
        operation: {
          type: isDownload ? 'download' : 'full_index',
          phase: isDownload ? 'downloading' : 'indexing',
          status: 'running',
          modelCode,
          attempt: 1,
          maxAttempts: 3,
          progress: isDownload
            ? { unit: 'bytes', completed: 32_000_000, total: 100_000_000 }
            : { unit: 'items', completed: 120, total: 1_000 },
          nextRetryAt: null,
          failure: null,
        },
        pollAfterMs: 1_000,
      };
      await route.fulfill({
        status: 202,
        json: { accepted: true, taskId, activeModelCode: modelCode },
      });
      return;
    }
    const retryIndexMatch = path.match(/^\/api\/semantic\/models\/([^/]+)\/retry-full-index$/u);
    if (request.method() === 'POST' && retryIndexMatch) {
      const modelCode = retryIndexMatch[1] as SemanticModelCode;
      lifecycle = {
        ...lifecycle,
        index: {
          ...lifecycle.index,
          status: 'building',
          failure: null,
        },
        models: lifecycle.models.map((item) => ({
          ...item,
          stage: item.modelCode === modelCode ? ('building' as const) : item.stage,
          allowedActions: [],
          failure: null,
        })),
        operation: {
          type: 'full_index',
          phase: 'indexing',
          status: 'running',
          modelCode,
          attempt: 1,
          maxAttempts: 3,
          progress: { unit: 'items', completed: 12, total: 100 },
          nextRetryAt: null,
          failure: null,
        },
        pollAfterMs: 1_000,
      };
      await route.fulfill({
        status: 202,
        json: { accepted: true, taskId, activeModelCode: modelCode },
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: 'INTERNAL_ERROR', message: '未模拟的语义接口' },
    });
  });
  return { read: () => lifecycle };
}

test('parameter settings starts the first download and saves its independent threshold', async ({
  page,
}, testInfo) => {
  const semantic = await mockSemanticApi(page, baseLifecycle());

  await page.goto('/maintenance');
  const links = page.getByRole('navigation', { name: '主导航' }).getByRole('link');
  await expect(page.getByRole('link', { name: '参数配置' })).toBeVisible();
  const labels = await links.allTextContents();
  expect(labels.indexOf('数据维护')).toBeLessThan(labels.indexOf('参数配置'));
  expect(labels.indexOf('参数配置')).toBeLessThan(labels.indexOf('系统状态'));
  await page.getByRole('link', { name: '参数配置' }).click();

  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();
  const lightweight = page.getByRole('article', { name: '轻量快速' });
  await lightweight.getByRole('button', { name: '下载并使用' }).click();
  await page
    .getByRole('dialog', { name: '确认下载并使用' })
    .getByRole('button', { name: '确认下载并使用' })
    .click();
  await expect(page.getByRole('progressbar', { name: '模型下载进度' })).toBeVisible();
  await expect(page.getByText('32 MB / 100 MB')).toBeVisible();

  const threshold = lightweight.getByRole('spinbutton', { name: '相似度门槛数值' });
  await threshold.fill('66');
  await threshold.blur();
  await expect.poll(() => semantic.read().models[0]?.threshold).toBe(66);
  await page.screenshot({
    path: testInfo.outputPath('parameter-settings-desktop.png'),
    fullPage: true,
  });
});

test('parameter settings confirms model switching and reports index progress', async ({ page }) => {
  const ready = baseLifecycle();
  ready.currentModelCode = 'multilingual-e5-small';
  ready.index = {
    ...ready.index,
    status: 'ready',
    processedItems: 1_000,
    totalItems: 1_000,
    availableForEnhancedSearch: true,
    updatedAt: timestamp,
  };
  ready.models = ready.models.map((item) =>
    item.modelCode === 'multilingual-e5-small'
      ? {
          ...item,
          role: 'current',
          fileState: 'downloaded',
          stage: 'ready',
          downloadedAt: timestamp,
          allowedActions: ['reindex'],
        }
      : item,
  );
  await mockSemanticApi(page, ready);
  await page.goto('/settings');

  await page
    .getByRole('article', { name: '质量优先' })
    .getByRole('button', { name: '使用此模型' })
    .click();
  const dialog = page.getByRole('dialog', { name: '确认切换模型' });
  await expect(dialog).toContainText('立即删除当前语义索引');
  await dialog.getByRole('button', { name: '确认切换' }).click();

  await expect(page.getByText('索引生成中')).toBeVisible();
  await expect(page.getByText('120 / 1000')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '索引生成进度' })).toBeVisible();
});

test('parameter settings exposes stage-specific failed index recovery', async ({ page }) => {
  const failed = baseLifecycle();
  failed.currentModelCode = 'multilingual-e5-small';
  const failure = {
    stage: 'full_index' as const,
    kind: 'retryable' as const,
    code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
    message: '索引任务中断',
    attempts: 3,
    occurredAt: timestamp,
  };
  failed.index = {
    ...failed.index,
    status: 'failed',
    failure,
  };
  failed.models = failed.models.map((item) =>
    item.modelCode === 'multilingual-e5-small'
      ? {
          ...item,
          role: 'current',
          fileState: 'downloaded',
          stage: 'failed',
          downloadedAt: timestamp,
          allowedActions: ['retry_full_index'],
          failure,
        }
      : item,
  );
  await mockSemanticApi(page, failed);
  await page.goto('/settings');

  await expect(page.getByText('索引任务中断')).toBeVisible();
  await page.getByRole('button', { name: '重试全量索引' }).click();
  await page
    .getByRole('dialog', { name: '确认重试全量索引' })
    .getByRole('button', { name: '确认重试全量索引' })
    .click();
  await expect(page.getByRole('progressbar', { name: '索引生成进度' })).toBeVisible();
  await expect(page.getByText('12 / 100')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试任务' })).toHaveCount(0);
});
