import type { McpSettingsResponse } from '@causality/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { McpSettingsPanel } from './McpSettingsPanel';

const token = `cau_pat_${'a'.repeat(43)}`;
const settings: McpSettingsResponse = {
  serviceStatus: 'running',
  endpoint: 'http://127.0.0.1:8081/mcp',
  updatedAt: '2026-07-28T10:00:00.000Z',
  clientConfig: { transport: 'streamable-http', url: 'http://127.0.0.1:8081/mcp' },
};

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(Response.json(body, { status }));
}

function renderPanel() {
  render(
    <AppProviders>
      <McpSettingsPanel />
    </AppProviders>,
  );
}

describe('McpSettingsPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('groups the service overview, token management, and client configuration help', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(settings)),
    );
    renderPanel();
    const panel = await screen.findByRole('region', { name: 'MCP 服务' });
    const overview = await within(panel).findByRole('region', { name: '服务概览' });
    expect(await within(overview).findByText('运行中')).toBeTruthy();
    expect(within(overview).getByText(settings.endpoint)).toBeTruthy();
    expect(within(overview).getByText('15')).toBeTruthy();
    expect(within(overview).getByText('Tool')).toBeTruthy();
    expect(within(overview).getByText('5')).toBeTruthy();
    expect(within(overview).getByText('Prompt')).toBeTruthy();
    expect(within(overview).getByText('4')).toBeTruthy();
    expect(within(overview).getByText('Resource')).toBeTruthy();
    expect(within(panel).getByRole('region', { name: '个人令牌管理' })).toBeTruthy();
    expect(within(panel).getByRole('region', { name: '客户端配置说明' })).toBeTruthy();
    expect(within(panel).queryByText(token)).toBeNull();
  });

  it('shows a newly-created token once and copies its complete JSON configuration', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith('/api/mcp/tokens') && options?.method === 'POST') {
        return jsonResponse(
          {
            token,
            summary: {
              id: '10000000-0000-4000-8000-000000000001',
              deviceName: 'Desktop',
              createdAt: settings.updatedAt,
              lastUsedAt: null,
              lastClientName: null,
              revokedAt: null,
            },
          },
          201,
        );
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    expect(within(dialog).getByText('设置一个便于识别的令牌名称。')).toBeTruthy();
    expect(within(dialog).queryByText(/设备名称|为此客户端/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('令牌名称'), { target: { value: 'Desktop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));
    expect(await within(dialog).findByText(token)).toBeTruthy();
    expect(
      within(dialog).getByText('此令牌仅显示一次。关闭窗口后无法再次查看，请立即保存。'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mcp/tokens',
      expect.objectContaining({ body: JSON.stringify({ deviceName: 'Desktop' }) }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '复制完整 JSON 配置' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(token)));
  });

  it('keeps a token active until revocation is confirmed and documents OAuth limits', async () => {
    const tokenId = '10000000-0000-4000-8000-000000000001';
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith(tokenId) && options?.method === 'DELETE')
        return jsonResponse({ revoked: true });
      return jsonResponse([
        {
          id: tokenId,
          deviceName: 'Desktop',
          createdAt: settings.updatedAt,
          lastUsedAt: null,
          lastClientName: null,
          revokedAt: null,
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    const panel = await screen.findByRole('region', { name: 'MCP 服务' });
    const help = await within(panel).findByRole('region', { name: '客户端配置说明' });
    expect(within(help).getByText(/不支持 OAuth discovery/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '撤销' }));
    const dialog = screen.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
    expect(
      within(dialog).getByText('撤销令牌“Desktop”后，使用该令牌的连接将在下一次请求时被拒绝。'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/客户端|设备/)).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(tokenId))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, options]) => String(input).endsWith(tokenId) && options?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });
});
