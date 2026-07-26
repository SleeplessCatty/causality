import type { SemanticWorkerStatus } from '@causality/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { SystemStatus } from './SystemStatus';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderStatus() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <SystemStatus />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('SystemStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['idle', '正常·未加载模型'],
    ['preparing', '正常·正在准备当前模型'],
    ['loaded', '正常·已加载当前模型'],
    ['missing', '异常·当前模型未加载'],
    ['mismatch', '异常·加载模型与当前配置不一致'],
  ] as const)('shows the Semantic Worker %s status', async (modelState, label) => {
    const worker: SemanticWorkerStatus = {
      status: 'online',
      modelState,
      loadedModelCode:
        modelState === 'loaded' ? 'bge-small-zh-v1.5' : modelState === 'mismatch' ? 'bge-m3' : null,
      checkedAt: '2026-07-26T10:00:00.000Z',
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/semantic/worker-status')) {
        return jsonResponse(worker);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderStatus();

    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText('Semantic Worker')).toBeTruthy();
    expect(screen.getByText('语义模型运行服务')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
    expect(screen.getByText('就绪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy();
    expect(screen.queryByText('数据检查')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/data-checks'))).toBe(
      false,
    );
  });

  it('shows an unreachable Worker without affecting API and database status', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/semantic/worker-status')) {
        return jsonResponse({
          status: 'unreachable',
          modelState: 'missing',
          loadedModelCode: null,
          checkedAt: '2026-07-26T10:00:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderStatus();

    expect(await screen.findByText('无法连接')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
    expect(screen.getByText('就绪')).toBeTruthy();
  });

  it('refetches all three runtime statuses once and never starts interval polling', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/semantic/worker-status')) {
        return jsonResponse({
          status: 'online',
          modelState: 'loaded',
          loadedModelCode: 'bge-small-zh-v1.5',
          checkedAt: '2026-07-26T10:00:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderStatus();
    await screen.findByText('正常·已加载当前模型');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/data-checks'))).toBe(
      false,
    );
  });
});
