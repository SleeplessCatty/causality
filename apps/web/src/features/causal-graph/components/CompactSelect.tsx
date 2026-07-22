import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface CompactSelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface CompactSelectProps<T extends string | number> {
  label: string;
  ariaLabel: string;
  value: T;
  options: Array<CompactSelectOption<T>>;
  onChange: (value: T) => void;
}

const menuOpenEvent = 'causality:compact-select-open';

export function CompactSelect<T extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: CompactSelectProps<T>) {
  const componentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
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
    if (open) listboxRef.current?.focus({ preventScroll: true });
  }, [open]);

  function openMenu(initialIndex?: number): void {
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(initialIndex ?? Math.max(0, selectedIndex));
    window.dispatchEvent(new CustomEvent(menuOpenEvent, { detail: componentId }));
    setOpen(true);
  }

  function choose(index: number): void {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.key === 'ArrowDown' ? 0 : undefined);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      openMenu(options.length - 1);
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setOpen(false);
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
    <div className="graph-toolbar-field graph-compact-select" ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="graph-compact-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={`${componentId}-listbox`}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
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
          className="graph-compact-select__menu"
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
