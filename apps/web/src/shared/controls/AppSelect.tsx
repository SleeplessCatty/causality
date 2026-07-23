import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface AppSelectOption<Value extends string | number> {
  value: Value;
  label: string;
}

interface AppSelectProps<Value extends string | number> {
  label: string;
  ariaLabel: string;
  value: Value;
  options: ReadonlyArray<AppSelectOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}

const menuOpenEvent = 'causality:app-select-open';

export function AppSelect<Value extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: AppSelectProps<Value>) {
  const componentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function handleOtherMenu(event: Event): void {
      if (event instanceof CustomEvent && event.detail !== componentId) setOpen(false);
    }
    function handleOutsidePointer(event: PointerEvent): void {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener(menuOpenEvent, handleOtherMenu);
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => {
      window.removeEventListener(menuOpenEvent, handleOtherMenu);
      document.removeEventListener('pointerdown', handleOutsidePointer);
    };
  }, [componentId]);

  useEffect(() => {
    if (!open) return;
    listboxRef.current?.focus({ preventScroll: true });
    const activeOption = listboxRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  function openMenu(initialIndex?: number): void {
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(initialIndex ?? Math.max(0, selectedIndex));
    window.dispatchEvent(new CustomEvent(menuOpenEvent, { detail: componentId }));
    setOpen(true);
  }

  function closeMenu(restoreFocus = false): void {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function choose(index: number): void {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 0 : undefined);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(options.length - 1);
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(event.key)
    ) {
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    event.preventDefault();
    if (event.key === 'Escape') {
      closeMenu(true);
    } else if (event.key === 'Home') {
      setActiveIndex(0);
    } else if (event.key === 'End') {
      setActiveIndex(options.length - 1);
    } else if (event.key === 'ArrowDown') {
      setActiveIndex((index) => (index >= options.length - 1 ? 0 : index + 1));
    } else if (event.key === 'ArrowUp') {
      setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
    } else {
      choose(activeIndex);
    }
  }

  return (
    <div className={`app-select${className ? ` ${className}` : ''}`} ref={rootRef}>
      <span className="app-select__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="app-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={`${componentId}-listbox`}
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selected?.label}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open ? (
        <div
          ref={listboxRef}
          id={`${componentId}-listbox`}
          className="app-select__menu"
          role="listbox"
          tabIndex={-1}
          aria-label={`${label}选项`}
          aria-activedescendant={`${componentId}-option-${activeIndex}`}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => (
            <button
              id={`${componentId}-option-${index}`}
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              className={index === activeIndex ? 'is-active' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
