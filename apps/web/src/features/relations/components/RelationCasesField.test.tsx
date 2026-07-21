import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationCasesField, type RelationCaseSelectionValue } from './RelationCasesField';

const existingCase = {
  id: '11111111-1111-4111-8111-111111111111',
  content: '2025年4月美国宣布新一轮关税措施',
};

function response(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function Fixture({ initial = [] }: { initial?: RelationCaseSelectionValue[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RelationCasesField value={value} onChange={setValue} onIncompleteChange={() => undefined} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('RelationCasesField', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds a row, searches after debounce, and selects an existing case', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      void input;
      return response({ items: [existingCase] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AppProviders>
        <Fixture />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加案例' }));
    fireEvent.change(screen.getByRole('combobox', { name: '具体案例 1' }), {
      target: { value: '关税' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('option', { name: existingCase.content }));

    expect(screen.getByTestId('value').textContent).toContain(existingCase.id);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=%E5%85%B3%E7%A8%8E'))).toBe(
      true,
    );
  });

  it('requires explicit confirmation to create a new case and removes rows without deleting cases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ items: [] })),
    );
    render(
      <AppProviders>
        <Fixture
          initial={[{ type: 'existing', caseId: existingCase.id, content: existingCase.content }]}
        />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加案例' }));
    fireEvent.change(screen.getByRole('combobox', { name: '具体案例 2' }), {
      target: { value: '2026年某公司发布盈利预警' },
    });
    fireEvent.click(
      await screen.findByRole('option', { name: '创建新案例：2026年某公司发布盈利预警' }),
    );
    expect(screen.getByTestId('value').textContent).toContain('"type":"new"');

    fireEvent.click(screen.getAllByRole('button', { name: '移除案例' })[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('value').textContent).not.toContain(existingCase.id),
    );
  });

  it('supports keyboard selection and rejects a duplicate confirmed row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ items: [existingCase] })),
    );
    render(
      <AppProviders>
        <Fixture
          initial={[{ type: 'existing', caseId: existingCase.id, content: existingCase.content }]}
        />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加案例' }));
    const input = screen.getByRole('combobox', { name: '具体案例 2' });
    fireEvent.change(input, { target: { value: '关税' } });
    await screen.findByRole('option', { name: existingCase.content });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('同一关系不能重复选择案例')).toBeTruthy();
  });
});
