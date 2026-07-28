import type { McpSettingsResponse } from '@causality/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { McpSettingsPanel } from './McpSettingsPanel';

const timestamp = '2026-07-28T10:00:00.000Z';
const initialToken = 'a'.repeat(64);
const rotatedToken = 'b'.repeat(64);

function settings(
  overrides: Partial<McpSettingsResponse> & Pick<McpSettingsResponse, 'accessToken'>,
): McpSettingsResponse {
  const { accessToken, ...rest } = overrides;
  return {
    serviceStatus: 'running',
    endpoint: 'http://127.0.0.1:8081/mcp',
    maskedToken: `${accessToken.slice(0, 4)}${'•'.repeat(8)}${accessToken.slice(-4)}`,
    accessToken,
    tokenVersion: accessToken === initialToken ? 1 : 2,
    updatedAt: timestamp,
    clientConfig: {
      transport: 'streamable-http',
      url: 'http://127.0.0.1:8081/mcp',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    ...rest,
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

function renderPanel() {
  render(
    <AppProviders>
      <McpSettingsPanel />
    </AppProviders>,
  );
}

describe('McpSettingsPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the service status and endpoint while keeping the access token masked by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(settings({ accessToken: initialToken }))),
    );

    renderPanel();

    const panel = await screen.findByRole('region', { name: 'MCP 服务' });
    expect(await within(panel).findByText('运行中')).toBeTruthy();
    expect(within(panel).getByText('http://127.0.0.1:8081/mcp')).toBeTruthy();
    expect(within(panel).getByText('aaaa••••••••aaaa')).toBeTruthy();
    expect(within(panel).queryByText(initialToken)).toBeNull();
  });

  it('reveals and hides the current token without requesting new settings', async () => {
    const fetchMock = vi.fn(() => jsonResponse(settings({ accessToken: initialToken })));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '显示访问令牌' }));
    expect(screen.getByText(initialToken)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '隐藏访问令牌' }));
    expect(screen.queryByText(initialToken)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('copies the complete Streamable HTTP client configuration', async () => {
    const current = settings({ accessToken: initialToken });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(current)),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '复制客户端配置' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(current.clientConfig, null, 2)),
    );
    expect(screen.getByRole('status').textContent).toContain('客户端配置已复制');
  });

  it('requires confirmation before rotating and replaces the token with refreshed settings', async () => {
    const initial = settings({ accessToken: initialToken, serviceStatus: 'stopped' });
    const rotated = settings({ accessToken: rotatedToken, serviceStatus: 'stopped' });
    const refreshed = settings({ accessToken: rotatedToken, serviceStatus: 'running' });
    let settingsReads = 0;
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/rotate-token') && options?.method === 'POST') {
        return jsonResponse({ settings: rotated });
      }
      settingsReads += 1;
      return jsonResponse(settingsReads === 1 ? initial : refreshed);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '显示访问令牌' }));
    fireEvent.click(screen.getByRole('button', { name: '重新生成令牌' }));

    const dialog = screen.getByRole('dialog', { name: '重新生成 MCP 访问令牌' });
    expect(dialog.textContent).toContain('现有客户端将断开');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重新生成' }));

    await waitFor(() => expect(screen.getByText(rotatedToken)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('运行中')).toBeTruthy());
    expect(settingsReads).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a failed rotation dialog open and dismisses its error after three seconds', async () => {
    const current = settings({ accessToken: initialToken });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) =>
      String(input).endsWith('/rotate-token') && options?.method === 'POST'
        ? jsonResponse({ code: 'INTERNAL_ERROR', message: '令牌生成失败' }, 500)
        : jsonResponse(current),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '重新生成令牌' }));
    vi.useFakeTimers();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认重新生成' }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('令牌生成失败');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
