import type {
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticTask,
} from '@causality/contracts';
import { expect, test, type Page } from '@playwright/test';

const taskId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-07-23T10:00:00.000Z';

function baseSettings(): SemanticSettingsResponse {
  return {
    activeModelCode: null,
    index: {
      status: 'empty',
      processedItems: 0,
      totalItems: 0,
      pendingItems: 0,
      updatedAt: null,
      error: null,
    },
    models: [
      {
        code: 'multilingual-e5-small',
        label: '轻量快速',
        description: '适合普通 CPU 的快速语义检索',
        languageLabel: '中文、英文及中英混排',
        dimensions: 384,
        expectedDownloadBytes: 135_392_857,
        threshold: 70,
        downloadStatus: 'not_downloaded',
        downloadedAt: null,
        isActive: false,
        error: null,
      },
      {
        code: 'bge-m3',
        label: '质量优先',
        description: '适合更高质量的多语言语义检索',
        languageLabel: '中文、英文及中英混排',
        dimensions: 1024,
        expectedDownloadBytes: 608_174_424,
        threshold: 55,
        downloadStatus: 'downloaded',
        downloadedAt: timestamp,
        isActive: false,
        error: null,
      },
    ],
    activeTask: null,
  };
}

function runningTask(
  type: 'download' | 'full_index',
  modelCode: SemanticModelCode,
  processed: number,
  total: number,
): SemanticTask {
  return {
    id: taskId,
    type,
    status: 'running',
    modelCode,
    processedItems: type === 'full_index' ? processed : 0,
    totalItems: type === 'full_index' ? total : 0,
    downloadedBytes: type === 'download' ? processed : 0,
    totalBytes: type === 'download' ? total : 0,
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    error: null,
  };
}

async function mockSemanticApi(
  page: Page,
  initial: SemanticSettingsResponse,
): Promise<{ read(): SemanticSettingsResponse }> {
  let settings = initial;
  await page.route('**/api/semantic/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === 'GET' && path === '/api/semantic/settings') {
      await route.fulfill({ status: 200, json: settings });
      return;
    }
    const thresholdMatch = path.match(/^\/api\/semantic\/models\/([^/]+)\/threshold$/u);
    if (request.method() === 'PATCH' && thresholdMatch) {
      const threshold = (request.postDataJSON() as { threshold: number }).threshold;
      settings = {
        ...settings,
        models: settings.models.map((model) =>
          model.code === thresholdMatch[1] ? { ...model, threshold } : model,
        ),
      };
      await route.fulfill({ status: 200, json: settings });
      return;
    }
    const useMatch = path.match(/^\/api\/semantic\/models\/([^/]+)\/use$/u);
    if (request.method() === 'POST' && useMatch) {
      const modelCode = useMatch[1] as SemanticModelCode;
      const isDownload =
        settings.models.find((model) => model.code === modelCode)?.downloadStatus !== 'downloaded';
      settings = {
        ...settings,
        activeModelCode: modelCode,
        index: {
          ...settings.index,
          status: isDownload ? 'waiting_model' : 'building',
          processedItems: isDownload ? 0 : 120,
          totalItems: isDownload ? 0 : 1_000,
        },
        models: settings.models.map((model) => ({
          ...model,
          isActive: model.code === modelCode,
          downloadStatus:
            model.code === modelCode && isDownload
              ? ('downloading' as const)
              : model.downloadStatus,
        })),
        activeTask: isDownload
          ? runningTask('download', modelCode, 32, 100)
          : runningTask('full_index', modelCode, 120, 1_000),
      };
      await route.fulfill({
        status: 202,
        json: { accepted: true, taskId, activeModelCode: modelCode },
      });
      return;
    }
    if (request.method() === 'POST' && path === '/api/semantic/retry') {
      const modelCode = settings.activeModelCode ?? 'multilingual-e5-small';
      settings = {
        ...settings,
        index: {
          ...settings.index,
          status: 'building',
          error: null,
        },
        activeTask: runningTask('full_index', modelCode, 12, 100),
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
  return { read: () => settings };
}

test('parameter settings starts the first download and saves its independent threshold', async ({
  page,
}, testInfo) => {
  const semantic = await mockSemanticApi(page, baseSettings());

  await page.goto('/maintenance');
  const links = page.getByRole('navigation', { name: '主导航' }).getByRole('link');
  const labels = await links.allTextContents();
  expect(labels.indexOf('数据维护')).toBeLessThan(labels.indexOf('参数配置'));
  expect(labels.indexOf('参数配置')).toBeLessThan(labels.indexOf('系统状态'));
  await page.getByRole('link', { name: '参数配置' }).click();

  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  const lightweight = page.getByRole('article', { name: '轻量快速' });
  await lightweight.getByRole('button', { name: '下载并使用' }).click();
  await expect(page.getByRole('progressbar', { name: '模型下载进度' })).toBeVisible();
  await expect(page.getByText('32 / 100')).toBeVisible();

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
  const ready = baseSettings();
  ready.activeModelCode = 'multilingual-e5-small';
  ready.index = {
    ...ready.index,
    status: 'ready',
    processedItems: 1_000,
    totalItems: 1_000,
    updatedAt: timestamp,
  };
  ready.models = ready.models.map((model) =>
    model.code === 'multilingual-e5-small'
      ? { ...model, isActive: true, downloadStatus: 'downloaded' }
      : model,
  );
  await mockSemanticApi(page, ready);
  await page.goto('/settings');

  await page
    .getByRole('article', { name: '质量优先' })
    .getByRole('button', { name: '切换到此模型' })
    .click();
  const dialog = page.getByRole('dialog', { name: '确认切换模型' });
  await expect(dialog).toContainText('立即删除当前语义索引');
  await dialog.getByRole('button', { name: '确认切换' }).click();

  await expect(page.getByText('索引生成中')).toBeVisible();
  await expect(page.getByText('120 / 1000')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '索引生成进度' })).toBeVisible();
});

test('parameter settings exposes failed task recovery', async ({ page }) => {
  const failed = baseSettings();
  failed.activeModelCode = 'multilingual-e5-small';
  failed.index = {
    ...failed.index,
    status: 'failed',
    error: '索引任务中断',
  };
  failed.models = failed.models.map((model) =>
    model.code === 'multilingual-e5-small'
      ? { ...model, isActive: true, downloadStatus: 'downloaded', error: '索引任务中断' }
      : model,
  );
  failed.activeTask = {
    ...runningTask('full_index', 'multilingual-e5-small', 12, 100),
    status: 'failed',
    completedAt: timestamp,
    error: '索引任务中断',
  };
  await mockSemanticApi(page, failed);
  await page.goto('/settings');

  await expect(page.getByText('索引任务中断').first()).toBeVisible();
  await page.getByRole('button', { name: '重试任务' }).click();
  await expect(page.getByRole('progressbar', { name: '索引生成进度' })).toBeVisible();
  await expect(page.getByText('12 / 100')).toBeVisible();
});
