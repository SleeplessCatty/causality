import type { McpSettingsResponse } from '@causality/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { McpSettingsPanel } from './McpSettingsPanel';

const token = `cau_pat_${'a'.repeat(43)}`;
const tokenId = '10000000-0000-4000-8000-000000000001';
const settings: McpSettingsResponse = {
  serviceStatus: 'running',
  endpoint: 'http://127.0.0.1:8081/mcp',
  updatedAt: '2026-07-28T10:00:00.000Z',
  clientConfig: { transport: 'streamable-http', url: 'http://127.0.0.1:8081/mcp' },
};

const activeToken = {
  id: tokenId,
  deviceName: 'Desktop',
  createdAt: settings.updatedAt,
  lastUsedAt: null,
  lastClientName: null,
  revokedAt: null,
};

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(Response.json(body, { status }));
}

function errorResponse(message: string): Promise<Response> {
  return jsonResponse({ code: 'INTERNAL_ERROR', message }, 500);
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
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith('/api/mcp/settings')
          ? jsonResponse(settings)
          : jsonResponse([activeToken]),
      ),
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
    const tokenManagement = within(panel).getByRole('region', { name: '个人令牌管理' });
    expect(within(tokenManagement).getByRole('button', { name: '创建个人令牌' })).toBeTruthy();
    const table = await within(tokenManagement).findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '令牌名称' })).toBeTruthy();
    expect(within(tokenManagement).getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(within(panel).getByRole('region', { name: '客户端配置说明' })).toBeTruthy();
    expect(within(panel).queryByText(token)).toBeNull();
    expect(within(panel).queryByText(/设备名称|为此客户端/)).toBeNull();
  });

  it('shows a newly-created token once, copies exact values, and forgets it after closing', async () => {
    const writeText = vi.fn((value: string) => {
      void value;
      return Promise.resolve();
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith('/api/mcp/tokens') && options?.method === 'POST') {
        return jsonResponse(
          {
            token,
            summary: activeToken,
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
    fireEvent.click(within(dialog).getByRole('button', { name: '复制令牌' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    fireEvent.click(within(dialog).getByRole('button', { name: '复制完整 JSON 配置' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(JSON.parse(writeText.mock.calls[1]![0])).toEqual({
      mcpServers: {
        causality: {
          transport: 'streamable-http',
          url: settings.endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '我已保存' }));
    expect(screen.queryByRole('dialog', { name: '创建 MCP 个人令牌' })).toBeNull();
    const tokenManagement = screen.getByRole('region', { name: '个人令牌管理' });
    fireEvent.click(within(tokenManagement).getByRole('button', { name: '创建个人令牌' }));
    const reopenedDialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    expect(within(reopenedDialog).queryByText(token)).toBeNull();
    expect(within(reopenedDialog).getByLabelText('令牌名称')).toBeTruthy();
  });

  it('refreshes the token row after confirmed revocation and documents OAuth limits', async () => {
    let revoked = false;
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith(tokenId) && options?.method === 'DELETE') {
        revoked = true;
        return jsonResponse({ revoked: true });
      }
      return jsonResponse([
        { ...activeToken, revokedAt: revoked ? '2026-07-28T11:00:00.000Z' : null },
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
    const revokedRow = await within(panel).findByRole('row', { name: /Desktop.*已撤销/ });
    expect(within(revokedRow).queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('shows creation failures inside the open dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (options?.method === 'POST') return errorResponse('无法创建令牌');
        return jsonResponse([]);
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    fireEvent.change(within(dialog).getByLabelText('令牌名称'), { target: { value: 'Desktop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('无法创建令牌');
  });

  it('shows copy failures beside the one-time token', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error('无法复制令牌'))) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (options?.method === 'POST') return jsonResponse({ token, summary: activeToken }, 201);
        return jsonResponse([]);
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    fireEvent.change(within(dialog).getByLabelText('令牌名称'), { target: { value: 'Desktop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '复制令牌' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('无法复制令牌');
  });

  it('keeps a failed revocation active and available to retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (options?.method === 'DELETE') return errorResponse('撤销令牌失败');
        return jsonResponse([activeToken]);
      }),
    );
    renderPanel();
    const tokenManagement = await screen.findByRole('region', { name: '个人令牌管理' });
    fireEvent.click(await within(tokenManagement).findByRole('button', { name: '撤销' }));
    const dialog = screen.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('撤销令牌失败');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    const activeRow = within(tokenManagement).getByRole('row', { name: /Desktop.*有效/ });
    expect(within(activeRow).getByRole('button', { name: '撤销' })).toBeTruthy();
  });
});
