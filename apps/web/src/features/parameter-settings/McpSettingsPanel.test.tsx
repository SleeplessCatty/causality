import type { McpSettingsResponse, McpTokenSummary } from '@causality/contracts';
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
const activeToken: McpTokenSummary = {
  id: tokenId,
  name: 'Codex',
  maskedToken: 'cau_pat_aaaa••••aaaa',
  createdAt: settings.updatedAt,
  lastUsedAt: null,
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

function settingsOrTokens(input: string | URL | Request, tokens: McpTokenSummary[]) {
  return String(input).endsWith('/api/mcp/settings')
    ? jsonResponse(settings)
    : jsonResponse(tokens);
}

describe('McpSettingsPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the service overview and an exact four-column token table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => settingsOrTokens(input, [activeToken])),
    );
    renderPanel();

    const panel = await screen.findByRole('region', { name: 'MCP 服务' });
    expect(await within(panel).findByRole('region', { name: '服务概览' })).toBeTruthy();
    expect(await within(panel).findByRole('region', { name: '客户端配置说明' })).toBeTruthy();
    const table = await within(panel).findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['令牌名称', '令牌', '最近使用时间', '操作']);
    const row = within(table).getByRole('row', { name: /Codex/ });
    expect(within(row).getByText(activeToken.maskedToken)).toBeTruthy();
    for (const action of ['查看', '复制令牌', '复制完整 JSON 配置', '撤销']) {
      expect(within(row).getByRole('button', { name: action })).toBeTruthy();
    }
    expect(within(panel).queryByText(/设备名称|仅显示一次|已撤销/)).toBeNull();
  });

  it('creates by token name, closes immediately, and refreshes the masked row', async () => {
    let tokens: McpTokenSummary[] = [];
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith('/api/mcp/tokens') && options?.method === 'POST') {
        tokens = [activeToken];
        return jsonResponse({ summary: activeToken }, 201);
      }
      return jsonResponse(tokens);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    fireEvent.change(within(dialog).getByLabelText('令牌名称'), { target: { value: 'Codex' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '创建 MCP 个人令牌' })).toBeNull(),
    );
    expect(await screen.findByRole('row', { name: /Codex/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mcp/tokens',
      expect.objectContaining({ body: JSON.stringify({ name: 'Codex' }) }),
    );
    expect(screen.queryByText(token)).toBeNull();
  });

  it('reveals only the selected row and hides the plaintext again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (String(input).endsWith(`/api/mcp/tokens/${tokenId}/secret`)) {
          return jsonResponse({ token });
        }
        return jsonResponse([activeToken]);
      }),
    );
    renderPanel();

    const row = await screen.findByRole('row', { name: /Codex/ });
    fireEvent.click(within(row).getByRole('button', { name: '查看' }));
    expect(await within(row).findByText(token)).toBeTruthy();
    expect(within(row).queryByText(activeToken.maskedToken)).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: '隐藏' }));
    expect(within(row).queryByText(token)).toBeNull();
    expect(within(row).getByText(activeToken.maskedToken)).toBeTruthy();
  });

  it('copies the token and complete JSON while keeping the row hidden', async () => {
    const writeText = vi.fn((value: string) => {
      void value;
      return Promise.resolve();
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (String(input).endsWith(`/api/mcp/tokens/${tokenId}/secret`)) {
          return jsonResponse({ token });
        }
        return jsonResponse([activeToken]);
      }),
    );
    renderPanel();

    const row = await screen.findByRole('row', { name: /Codex/ });
    fireEvent.click(within(row).getByRole('button', { name: '复制令牌' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    expect(within(row).queryByText(token)).toBeNull();
    expect(await screen.findByText('令牌已复制')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: '复制完整 JSON 配置' }));
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
    expect(await screen.findByText('JSON 配置已复制')).toBeTruthy();
    expect(within(row).queryByText(token)).toBeNull();
  });

  it('hard-deletes a token after confirmation and removes the row', async () => {
    let tokens = [activeToken];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (String(input).endsWith(tokenId) && options?.method === 'DELETE') {
          tokens = [];
          return jsonResponse({ deleted: true });
        }
        return jsonResponse(tokens);
      }),
    );
    renderPanel();

    const row = await screen.findByRole('row', { name: /Codex/ });
    fireEvent.click(within(row).getByRole('button', { name: '撤销' }));
    const dialog = screen.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /Codex/ })).toBeNull());
  });

  it('keeps duplicate-name and deletion errors in their active dialogs', async () => {
    let deleteFails = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
        if (options?.method === 'POST') {
          return jsonResponse({ code: 'TOKEN_NAME_EXISTS', message: '令牌名称已存在' }, 409);
        }
        if (options?.method === 'DELETE' && deleteFails) {
          return jsonResponse({ code: 'INTERNAL_ERROR', message: '删除令牌失败' }, 500);
        }
        return jsonResponse([activeToken]);
      }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    let dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    fireEvent.change(within(dialog).getByLabelText('令牌名称'), { target: { value: 'Codex' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('令牌名称已存在');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    deleteFails = true;
    const row = screen.getByRole('row', { name: /Codex/ });
    fireEvent.click(within(row).getByRole('button', { name: '撤销' }));
    dialog = screen.getByRole('dialog', { name: '撤销 MCP 个人令牌' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('删除令牌失败');
    expect(screen.getByRole('row', { name: /Codex/ })).toBeTruthy();
  });

  it('contains and exposes an 80-character token name', async () => {
    const longNameToken = { ...activeToken, name: 'A'.repeat(80) };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => settingsOrTokens(input, [longNameToken])),
    );
    renderPanel();

    const tokenName = await screen.findByText(longNameToken.name);
    expect(tokenName.classList.contains('overflow-text--single-line')).toBe(true);
    fireEvent.focus(tokenName);
    expect((await screen.findByRole('tooltip')).textContent).toBe(longNameToken.name);
  });
});
