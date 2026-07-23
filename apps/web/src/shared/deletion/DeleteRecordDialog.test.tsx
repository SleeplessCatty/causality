import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { DeleteRecordDialog } from './DeleteRecordDialog';

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof DeleteRecordDialog>> = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <DeleteRecordDialog
        open
        title="删除原子事件"
        message="确认永久删除这个原子事件？此操作无法恢复。"
        blocked={false}
        pending={false}
        error={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DeleteRecordDialog', () => {
  it('renders no dialog while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows compact copy without association lists or record previews', () => {
    renderDialog();

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: '删除原子事件' })).toBeTruthy();
    expect(screen.getByText('确认永久删除这个原子事件？此操作无法恢复。')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: '确认删除' }).hasAttribute('disabled')).toBe(false);
  });

  it('renders only navigation when deletion is blocked', () => {
    renderDialog({
      blocked: true,
      message: '这个原子事件存在关联因果关系，必须先删除相关因果关系。',
      blockedAction: {
        label: '查看相关因果关系',
        href: '/relations?eventId=11111111-1111-4111-8111-111111111111',
      },
    });

    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
    expect(screen.getByRole('link', { name: '查看相关因果关系' }).getAttribute('href')).toBe(
      '/relations?eventId=11111111-1111-4111-8111-111111111111',
    );
  });

  it('disables actions while pending and keeps errors in the dialog', () => {
    renderDialog({ pending: true, error: '删除失败，请稍后重试' });

    expect(screen.getByRole('alert').textContent).toBe('删除失败，请稍后重试');
    expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '删除中…' }).hasAttribute('disabled')).toBe(true);
  });

  it('closes from cancel and Escape', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('keeps keyboard focus inside the modal', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认删除' });

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('keeps focus in the dialog while deletion becomes pending', () => {
    const view = renderDialog();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));

    view.rerender(
      <MemoryRouter>
        <DeleteRecordDialog
          open
          title="删除原子事件"
          message="确认永久删除这个原子事件？此操作无法恢复。"
          blocked={false}
          pending
          error={null}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});
