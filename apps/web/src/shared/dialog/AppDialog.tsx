import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

export interface AppDialogProps {
  open: boolean;
  title: string;
  descriptionId?: string;
  pending?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  actions: ReactNode;
  onClose(): void;
}

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function AppDialog({
  open,
  title,
  descriptionId,
  pending = false,
  initialFocusRef,
  className,
  children,
  actions,
  onClose,
}: AppDialogProps) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  });

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector) ??
      dialogRef.current;
    initialFocus?.focus();

    return () => previousFocus?.focus();
  }, [initialFocusRef, open]);

  useEffect(() => {
    if (!open) return;
    if (pending) {
      dialogRef.current?.focus();
      return;
    }
    if (!dialogRef.current?.contains(document.activeElement)) {
      const nextFocus =
        initialFocusRef?.current ??
        dialogRef.current?.querySelector<HTMLElement>(focusableSelector) ??
        dialogRef.current;
      nextFocus?.focus();
    }
  }, [initialFocusRef, open, pending]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="delete-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={['delete-dialog', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="delete-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
