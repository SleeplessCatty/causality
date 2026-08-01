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
  render(<AppProviders><McpSettingsPanel /></AppProviders>);
}

describe('McpSettingsPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows service help without exposing a token', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(settings)));
    renderPanel();
    const panel = await screen.findByRole('region', { name: 'MCP 服务' });
    expect(await within(panel).findByText('运行中')).toBeTruthy();
    expect(within(panel).getByText(settings.endpoint)).toBeTruthy();
    expect(within(panel).queryByText(token)).toBeNull();
  });

  it('shows a newly-created token once and copies its complete JSON configuration', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/mcp/settings')) return jsonResponse(settings);
      if (String(input).endsWith('/api/mcp/tokens') && options?.method === 'POST') {
        return jsonResponse({ token, summary: { id: '10000000-0000-4000-8000-000000000001', deviceName: 'Desktop', createdAt: settings.updatedAt, lastUsedAt: null, lastClientName: null, revokedAt: null } }, 201);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '创建个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '创建 MCP 个人令牌' });
    fireEvent.change(within(dialog).getByLabelText('设备名称'), { target: { value: 'Desktop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建令牌' }));
    expect(await within(dialog).findByText(token)).toBeTruthy();
    expect(within(dialog).getByText('此令牌仅显示一次。关闭窗口后无法再次查看，请立即保存。')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '复制完整 JSON 配置' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(token)));
  });
});
