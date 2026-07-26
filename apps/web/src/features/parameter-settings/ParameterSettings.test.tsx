import type { SemanticSettingsResponse } from '@causality/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { ParameterSettings } from './ParameterSettings';

const settings: SemanticSettingsResponse = {
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
      code: 'bge-small-zh-v1.5',
      label: '中文轻量',
      description: '体积小、索引快，适合以中文内容为主的数据',
      languageLabel: '中文',
      dimensions: 512,
      expectedDownloadBytes: 24_451_175,
      threshold: 62,
      downloadStatus: 'downloaded',
      downloadedAt: '2026-07-23T09:00:00.000Z',
      isActive: false,
      error: null,
    },
    {
      code: 'multilingual-e5-small',
      label: '轻量快速',
      description: '适合普通 CPU 的快速语义检索',
      languageLabel: '中文、英文及中英混排',
      dimensions: 384,
      expectedDownloadBytes: 135_392_857,
      threshold: 90,
      downloadStatus: 'not_downloaded',
      downloadedAt: null,
      isActive: false,
      error: null,
    },
    {
      code: 'granite-embedding-97m-multilingual-r2',
      label: '均衡多语言',
      description: '在模型体积、跨语言能力和检索质量之间保持平衡',
      languageLabel: '中文、英文及多语言',
      dimensions: 384,
      expectedDownloadBytes: 123_174_716,
      threshold: 80,
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
      downloadedAt: '2026-07-23T10:00:00.000Z',
      isActive: false,
      error: null,
    },
  ],
  activeTask: null,
};

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
  afterEach(() => vi.unstubAllGlobals());

  it('shows all built-in models, independent thresholds, and no enable switch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(settings)),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: '参数配置' })).toBeTruthy();
    const lightweight = screen.getByRole('article', { name: '轻量快速' });
    expect(screen.getByRole('article', { name: '中文轻量' })).toBeTruthy();
    expect(screen.getByRole('article', { name: '均衡多语言' })).toBeTruthy();
    const quality = screen.getByRole('article', { name: '质量优先' });

    expect(within(lightweight).getByText('中文、英文及中英混排')).toBeTruthy();
    expect(within(lightweight).getByText('约 129 MB')).toBeTruthy();
    expect(
      (
        within(lightweight).getByRole('spinbutton', {
          name: '相似度门槛数值',
        }) as HTMLInputElement
      ).valueAsNumber,
    ).toBe(90);
    expect(
      (
        within(quality).getByRole('spinbutton', {
          name: '相似度门槛数值',
        }) as HTMLInputElement
      ).valueAsNumber,
    ).toBe(55);
    expect(within(lightweight).getByRole('button', { name: '下载并使用' })).toBeTruthy();
    expect(within(quality).getByRole('button', { name: '切换到此模型' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the active ready model and index build progress', async () => {
    const activeReady: SemanticSettingsResponse = {
      ...settings,
      activeModelCode: 'multilingual-e5-small',
      index: {
        status: 'ready',
        processedItems: 1_000,
        totalItems: 1_000,
        pendingItems: 0,
        updatedAt: '2026-07-23T11:00:00.000Z',
        error: null,
      },
      models: settings.models.map((model) =>
        model.code === 'multilingual-e5-small'
          ? { ...model, isActive: true, downloadStatus: 'downloaded' as const }
          : model,
      ),
    };
    const building: SemanticSettingsResponse = {
      ...activeReady,
      index: {
        ...activeReady.index,
        status: 'building',
        processedItems: 120,
        totalItems: 1_000,
      },
      activeTask: {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'full_index',
        status: 'running',
        modelCode: 'multilingual-e5-small',
        processedItems: 120,
        totalItems: 1_000,
        downloadedBytes: 0,
        totalBytes: 0,
        createdAt: '2026-07-23T10:00:00.000Z',
        startedAt: '2026-07-23T10:01:00.000Z',
        updatedAt: '2026-07-23T10:02:00.000Z',
        completedAt: null,
        error: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(building)),
    );
    renderPage();

    const activeModel = await screen.findByRole('article', { name: '轻量快速' });
    expect(activeModel.className).toContain('semantic-model-card--active');
    expect(within(activeModel).getByText('已下载')).toBeTruthy();
    expect(within(activeModel).getByText('暂不可用')).toBeTruthy();
    expect(within(activeModel).getByText('索引生成中')).toBeTruthy();
    expect(screen.getByText('120 / 1000')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: '索引生成进度' });
    expect((progress as HTMLProgressElement).value).toBe(120);
    expect(
      (within(activeModel).getByRole('button', { name: '重新索引' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows independent download, availability, and index badges and requests a full reindex', async () => {
    const activeReady: SemanticSettingsResponse = {
      ...settings,
      activeModelCode: 'multilingual-e5-small',
      index: {
        status: 'ready',
        processedItems: 600,
        totalItems: 600,
        pendingItems: 0,
        updatedAt: '2026-07-23T11:00:00.000Z',
        error: null,
      },
      models: settings.models.map((model) =>
        model.code === 'multilingual-e5-small'
          ? { ...model, isActive: true, downloadStatus: 'downloaded' as const }
          : model,
      ),
    };
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).endsWith('/reindex')
        ? jsonResponse(
            {
              accepted: true,
              taskId: '44444444-4444-4444-8444-444444444444',
              activeModelCode: 'multilingual-e5-small',
            },
            202,
          )
        : jsonResponse(activeReady),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const activeModel = await screen.findByRole('article', { name: '轻量快速' });
    expect(within(activeModel).getByText('已下载')).toBeTruthy();
    expect(within(activeModel).getByText('可用')).toBeTruthy();
    expect(within(activeModel).getByText('索引就绪')).toBeTruthy();
    fireEvent.click(within(activeModel).getByRole('button', { name: '重新索引' }));
    const dialog = screen.getByRole('dialog', { name: '确认重新索引' });
    expect(dialog.textContent).toContain('不会删除原子事件、因果关系和具体案例');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重新索引' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/reindex',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('starts the first model directly, confirms a switch, saves thresholds, and retries failures', async () => {
    const failed: SemanticSettingsResponse = {
      ...settings,
      activeModelCode: 'multilingual-e5-small',
      index: {
        ...settings.index,
        status: 'failed',
        error: '索引任务中断',
      },
      models: settings.models.map((model) =>
        model.code === 'multilingual-e5-small'
          ? {
              ...model,
              isActive: true,
              downloadStatus: 'downloaded' as const,
              error: '索引任务中断',
            }
          : model,
      ),
      activeTask: {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'full_index',
        status: 'failed',
        modelCode: 'multilingual-e5-small',
        processedItems: 12,
        totalItems: 100,
        downloadedBytes: 0,
        totalBytes: 0,
        createdAt: '2026-07-23T10:00:00.000Z',
        startedAt: '2026-07-23T10:01:00.000Z',
        updatedAt: '2026-07-23T10:02:00.000Z',
        completedAt: '2026-07-23T10:03:00.000Z',
        error: '索引任务中断',
      },
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/threshold')) return jsonResponse(failed);
      if (url.endsWith('/retry') || url.endsWith('/use')) {
        return jsonResponse(
          {
            accepted: true,
            taskId: '33333333-3333-4333-8333-333333333333',
            activeModelCode: url.includes('bge-m3') ? 'bge-m3' : 'multilingual-e5-small',
          },
          202,
        );
      }
      return jsonResponse(failed);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByRole('heading', { name: '参数配置' });
    const quality = screen.getByRole('article', { name: '质量优先' });
    fireEvent.click(within(quality).getByRole('button', { name: '切换到此模型' }));
    const dialog = screen.getByRole('dialog', { name: '确认切换模型' });
    expect(dialog.textContent).toContain('将立即删除当前语义索引');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/models/bge-m3/use',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    const light = screen.getByRole('article', { name: '轻量快速' });
    const threshold = within(light).getByRole('spinbutton', { name: '相似度门槛数值' });
    fireEvent.change(threshold, { target: { value: '66' } });
    fireEvent.blur(threshold);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/models/multilingual-e5-small/threshold',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ threshold: 66 }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '重试任务' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/retry',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('keeps the threshold slider appearance stable while its value is being saved', async () => {
    let resolveThreshold!: (response: Response) => void;
    const thresholdResponse = new Promise<Response>((resolve) => {
      resolveThreshold = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).endsWith('/threshold') ? thresholdResponse : jsonResponse(settings),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const model = await screen.findByRole('article', { name: '中文轻量' });
    const slider = within(model).getByRole('slider', {
      name: '相似度门槛滑块',
    }) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '64' } });
    fireEvent.pointerUp(slider);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/semantic/models/bge-small-zh-v1.5/threshold',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(slider.disabled).toBe(true);
    expect(slider.classList.contains('range-control--stable-disabled')).toBe(true);

    resolveThreshold(
      await jsonResponse({
        ...settings,
        models: settings.models.map((item) =>
          item.code === 'bge-small-zh-v1.5' ? { ...item, threshold: 64 } : item,
        ),
      }),
    );
    await waitFor(() => expect(slider.disabled).toBe(false));
  });

  it('shows a failed switch action inside the still-open confirmation dialog', async () => {
    const activeReady: SemanticSettingsResponse = {
      ...settings,
      activeModelCode: 'multilingual-e5-small',
      index: {
        ...settings.index,
        status: 'ready',
        processedItems: 1_000,
        totalItems: 1_000,
      },
      models: settings.models.map((model) =>
        model.code === 'multilingual-e5-small'
          ? { ...model, isActive: true, downloadStatus: 'downloaded' as const }
          : model,
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith('/use')
          ? jsonResponse(
              {
                code: 'SEMANTIC_SWITCH_CONFLICT',
                message: '已有模型任务正在执行',
              },
              409,
            )
          : jsonResponse(activeReady),
      ),
    );
    renderPage();

    const quality = await screen.findByRole('article', { name: '质量优先' });
    fireEvent.click(within(quality).getByRole('button', { name: '切换到此模型' }));
    const dialog = screen.getByRole('dialog', { name: '确认切换模型' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('已有模型任务正在执行');
  });
});
