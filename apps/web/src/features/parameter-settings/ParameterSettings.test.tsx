import type {
  SemanticAction,
  SemanticFailure,
  SemanticLifecycleSnapshot,
  SemanticModelLifecycle,
  SemanticModelStage,
  SemanticOperation,
} from '@causality/contracts';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { ParameterSettings } from './ParameterSettings';

const timestamp = '2026-07-26T10:00:00.000Z';
const acceptedAction = {
  accepted: true as const,
  taskId: '11111111-1111-4111-8111-111111111111',
  activeModelCode: 'bge-small-zh-v1.5' as const,
};

const retryableFailure: SemanticFailure = {
  stage: 'full_index',
  kind: 'retryable',
  code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
  message: '数据库暂时不可用',
  attempts: 3,
  occurredAt: timestamp,
};

function model(
  overrides: Partial<SemanticModelLifecycle> & Pick<SemanticModelLifecycle, 'modelCode' | 'label'>,
): SemanticModelLifecycle {
  const { modelCode, label, ...rest } = overrides;
  return {
    modelCode,
    label,
    description: '用于测试生命周期显示',
    languageLabel: '中文',
    dimensions: 512,
    expectedDownloadBytes: 25_200_000,
    threshold: 65,
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

function lifecycle(overrides: Partial<SemanticLifecycleSnapshot> = {}): SemanticLifecycleSnapshot {
  return {
    currentModelCode: null,
    models: [
      model({ modelCode: 'bge-small-zh-v1.5', label: '中文轻量' }),
      model({
        modelCode: 'multilingual-e5-small',
        label: '轻量快速',
        fileState: 'downloaded',
        stage: 'downloaded',
        downloadedAt: timestamp,
        allowedActions: ['use'],
      }),
      model({
        modelCode: 'granite-embedding-97m-multilingual-r2',
        label: '均衡多语言',
      }),
      model({
        modelCode: 'bge-m3',
        label: '质量优先',
        dimensions: 1024,
        expectedDownloadBytes: 585_565_019,
      }),
    ],
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
    operation: null,
    worker: {
      status: 'online',
      modelState: 'idle',
      loadedModelCode: null,
      checkedAt: timestamp,
    },
    pollAfterMs: null,
    updatedAt: timestamp,
    ...overrides,
  };
}

function currentLifecycle(options: {
  stage: SemanticModelStage;
  allowedActions: SemanticAction[];
  failure?: SemanticFailure | null;
  failedItems?: number;
  operation?: SemanticOperation | null;
  pollAfterMs?: 1_000 | 5_000 | null;
}): SemanticLifecycleSnapshot {
  const base = lifecycle();
  return {
    ...base,
    currentModelCode: 'bge-small-zh-v1.5',
    models: base.models.map((item) =>
      item.modelCode === 'bge-small-zh-v1.5'
        ? {
            ...item,
            fileState: options.stage === 'invalid' ? 'invalid' : 'downloaded',
            downloadedAt: options.stage === 'invalid' ? null : timestamp,
            role: 'current',
            stage: options.stage,
            allowedActions: options.allowedActions,
            failure: options.failure ?? null,
          }
        : item,
    ),
    index: {
      ...base.index,
      status:
        options.stage === 'incomplete'
          ? 'incomplete'
          : options.stage === 'ready'
            ? 'ready'
            : options.stage === 'building'
              ? 'building'
              : options.stage === 'failed'
                ? 'failed'
                : 'loading',
      failedItems: options.failedItems ?? 0,
      failure: options.failure ?? null,
    },
    operation: options.operation ?? null,
    pollAfterMs: options.pollAfterMs ?? null,
  };
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderPage() {
  render(
    <AppProviders>
      <ParameterSettings />
    </AppProviders>,
  );
}

describe('ParameterSettings', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('distinguishes file, model-role, and index badges', async () => {
    const snapshot = lifecycle();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(snapshot)),
    );

    renderPage();

    const downloadedModel = await screen.findByRole('article', { name: '轻量快速' });
    const statuses = within(downloadedModel).getByLabelText('模型状态');
    expect(within(statuses).getByText('文件已下载')).toBeTruthy();
    expect(within(statuses).getByText('候选模型')).toBeTruthy();
    expect(within(statuses).getByText('索引未建')).toBeTruthy();
    expect(within(statuses).queryByText('已下载')).toBeNull();
  });

  it('renders model actions only from the lifecycle snapshot', async () => {
    const snapshot = currentLifecycle({
      stage: 'invalid',
      allowedActions: ['redownload_and_use'],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(snapshot)),
    );

    renderPage();

    const current = await screen.findByRole('article', { name: '中文轻量' });
    expect(within(current).getByRole('button', { name: '重新下载并使用' })).toBeTruthy();
    expect(
      within(screen.getByRole('article', { name: '轻量快速' })).getByRole('button', {
        name: '使用此模型',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('article', { name: '均衡多语言' })).getByRole('button', {
        name: '下载并使用',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试任务' })).toBeNull();
    expect(
      within(screen.getByRole('article', { name: '质量优先' })).getByText('约 586 MB'),
    ).toBeTruthy();
  });

  it.each([
    ['load', '重试加载', 'retry_load'],
    ['full_index', '重试全量索引', 'retry_full_index'],
  ] as const)(
    'renders the %s failure action and calls its dedicated endpoint',
    async (failureStage, buttonLabel, action) => {
      const failure = { ...retryableFailure, stage: failureStage };
      const snapshot = currentLifecycle({
        stage: 'failed',
        allowedActions: [action],
        failure,
      });
      const fetchMock = vi.fn((input: string | URL | Request) =>
        String(input).endsWith(failureStage === 'load' ? '/retry-load' : '/retry-full-index')
          ? jsonResponse(acceptedAction, 202)
          : jsonResponse(snapshot),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: buttonLabel }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: `确认${buttonLabel}` }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/semantic/models/bge-small-zh-v1.5/${
            failureStage === 'load' ? 'retry-load' : 'retry-full-index'
          }`,
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    },
  );

  it('shows incomplete index failures and offers a full reindex', async () => {
    const snapshot = currentLifecycle({
      stage: 'incomplete',
      allowedActions: ['reindex'],
      failedItems: 3,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(snapshot)),
    );
    renderPage();

    expect(await screen.findByText('语义索引不完整')).toBeTruthy();
    expect(screen.getByText('失败 3 项')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新索引' })).toBeTruthy();
  });

  it('saves each model data-check threshold independently without invoking a model action', async () => {
    const initial = lifecycle();
    const saved = lifecycle({
      models: initial.models.map((item) =>
        item.modelCode === 'bge-small-zh-v1.5' ? { ...item, dedupeThreshold: 80 } : item,
      ),
    });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/dedupe-threshold')) return jsonResponse(saved);
      if (options?.method === 'POST')
        throw new Error('threshold save must not start a model action');
      return jsonResponse(initial);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const current = await screen.findByRole('article', { name: '中文轻量' });
    expect(within(current).getByLabelText('相似度门槛数值')).toBeTruthy();
    const input = within(current).getByLabelText('数据查重门槛数值');
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/models/bge-small-zh-v1.5/dedupe-threshold',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ threshold: 80 }) }),
      ),
    );
  });

  it('renders the active operation once and exposes no model actions while it runs', async () => {
    const operation: SemanticOperation = {
      type: 'full_index',
      phase: 'indexing',
      status: 'running',
      modelCode: 'bge-small-zh-v1.5',
      attempt: 1,
      maxAttempts: 3,
      progress: { unit: 'items', completed: 120, total: 600 },
      nextRetryAt: null,
      failure: null,
    };
    const snapshot = currentLifecycle({
      stage: 'building',
      allowedActions: [],
      operation,
      pollAfterMs: 1_000,
    });
    snapshot.models = snapshot.models.map((item) => ({ ...item, allowedActions: [] }));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(snapshot)),
    );
    renderPage();

    expect(await screen.findByText('120 / 600')).toBeTruthy();
    expect(screen.getAllByRole('progressbar', { name: '索引生成进度' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '下载并使用' })).toBeNull();
    expect(screen.queryByRole('button', { name: '使用此模型' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新索引' })).toBeNull();
  });

  it('polls at the server-directed interval and stops after a stable response', async () => {
    vi.useFakeTimers();
    const building = currentLifecycle({
      stage: 'building',
      allowedActions: [],
      operation: {
        type: 'full_index',
        phase: 'indexing',
        status: 'running',
        modelCode: 'bge-small-zh-v1.5',
        attempt: 1,
        maxAttempts: 3,
        progress: { unit: 'items', completed: 120, total: 600 },
        nextRetryAt: null,
        failure: null,
      },
      pollAfterMs: 1_000,
    });
    const ready = currentLifecycle({ stage: 'ready', allowedActions: ['reindex'] });
    const responses = [building, building, ready];
    const fetchMock = vi.fn(() =>
      jsonResponse(responses[Math.min(fetchMock.mock.calls.length - 1, responses.length - 1)]),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the five-second server interval when the Worker is unreachable', async () => {
    vi.useFakeTimers();
    const snapshot = currentLifecycle({
      stage: 'building',
      allowedActions: [],
      pollAfterMs: 5_000,
    });
    snapshot.worker = {
      status: 'unreachable',
      modelState: 'missing',
      loadedModelCode: null,
      checkedAt: timestamp,
    };
    const fetchMock = vi.fn(() => jsonResponse(snapshot));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the lifecycle snapshot when the window regains focus', async () => {
    const fetchMock = vi.fn(() => jsonResponse(lifecycle()));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByRole('heading', { name: '参数配置' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
