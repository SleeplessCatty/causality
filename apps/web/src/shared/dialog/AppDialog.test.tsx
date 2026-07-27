import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AppDialog } from './AppDialog';

function DialogExample({
  open = true,
  pending = false,
  onClose = vi.fn(),
}: {
  open?: boolean;
  pending?: boolean;
  onClose?: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AppDialog
      open={open}
      title="确认操作"
      descriptionId="dialog-description"
      pending={pending}
      initialFocusRef={cancelRef}
      onClose={onClose}
      actions={
        <>
          <button ref={cancelRef} type="button" disabled={pending}>
            取消
          </button>
          <button type="button" disabled={pending}>
            确认
          </button>
        </>
      }
    >
      <p id="dialog-description">操作说明</p>
    </AppDialog>
  );
}

describe('AppDialog', () => {
  it('renders modal semantics and moves initial focus to the requested control', () => {
    render(<DialogExample />);

    const dialog = screen.getByRole('dialog', { name: '确认操作' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe('dialog-description');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  });

  it('wraps Tab and Shift+Tab inside the dialog', () => {
    render(<DialogExample />);
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认' });

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('closes from Escape and backdrop mouse down', () => {
    const onClose = vi.fn();
    const view = render(<DialogExample onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(view.container.querySelector('.delete-dialog-backdrop')!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the opener after the dialog closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开
          </button>
          <DialogExample open={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '打开' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('refuses Escape and backdrop close while pending and keeps focus in the dialog', () => {
    const onClose = vi.fn();
    const view = render(<DialogExample pending onClose={onClose} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(view.container.querySelector('.delete-dialog-backdrop')!);

    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog);
  });

  it('renders nothing while closed', () => {
    render(<DialogExample open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
