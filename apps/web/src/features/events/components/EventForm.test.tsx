import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { EventForm } from './EventForm';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AppProviders>
      <MemoryRouter>
        <EventForm
          mode="create"
          initialValue={{ name: '', description: null, aliases: [], keywords: [] }}
          onSubmit={onSubmit}
          cancelTo="/events"
        />
      </MemoryRouter>
    </AppProviders>,
  );
  return onSubmit;
}

describe('EventForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows naming guidance and manages aliases and keywords with the keyboard', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [] })),
    );
    renderForm();

    expect(
      screen.getByText(
        '使用“主体 + 单一状态变化”命名，例如“原油价格上涨”。不要在名称中同时描述原因和结果。',
      ),
    ).toBeTruthy();

    const aliasInput = screen.getByRole('textbox', { name: '添加别名' });
    fireEvent.change(aliasInput, { target: { value: '油价上涨' } });
    fireEvent.keyDown(aliasInput, { key: 'Enter' });
    expect(screen.getByText('油价上涨')).toBeTruthy();

    const keywordInput = screen.getByRole('textbox', { name: '添加关键词' });
    fireEvent.change(keywordInput, { target: { value: '原油' } });
    fireEvent.keyDown(keywordInput, { key: '，' });
    expect(screen.getByText('原油')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '移除别名 油价上涨' }));
    expect(screen.queryByText('油价上涨')).toBeNull();
  });

  it('validates duplicate tags and required name before submitting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [] })),
    );
    const onSubmit = renderForm();
    const aliasInput = screen.getByRole('textbox', { name: '添加别名' });

    fireEvent.change(aliasInput, { target: { value: 'Oil Price' } });
    fireEvent.keyDown(aliasInput, { key: 'Enter' });
    fireEvent.change(aliasInput, { target: { value: ' oil price ' } });
    fireEvent.keyDown(aliasInput, { key: 'Enter' });
    expect(screen.getByText('同一事件不能有重复别名')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '创建事件' }));
    expect(await screen.findByText('请输入标准名称')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows minimal candidates and submits normalized values once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          items: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: '原油价格上涨',
            },
          ],
        }),
      ),
    );
    const onSubmit = renderForm();

    fireEvent.change(screen.getByRole('textbox', { name: '标准名称' }), {
      target: { value: '  原油供给减少  ' },
    });
    expect(await screen.findByText('可能已存在')).toBeTruthy();
    expect(screen.getByRole('link', { name: '原油价格上涨' })).toBeTruthy();
    expect(screen.queryByText(/匹配|分数|命中别名/)).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: '事件说明' }), {
      target: { value: '  原油供应量下降  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建事件' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: '原油供给减少',
        description: '原油供应量下降',
        aliases: [],
        keywords: [],
      }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
