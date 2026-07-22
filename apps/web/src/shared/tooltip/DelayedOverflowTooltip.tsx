import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
} from 'react';

interface TooltipChildProps extends HTMLAttributes<HTMLElement> {
  ref?: (node: HTMLElement | null) => void;
}

interface DelayedOverflowTooltipProps {
  values: string[];
  children: ReactElement<TooltipChildProps>;
  delay?: number;
}

export function DelayedOverflowTooltip({
  values,
  children,
  delay = 2_000,
}: DelayedOverflowTooltipProps) {
  const tooltipId = useId();
  const elementRef = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const [enabled, setEnabled] = useState(values.length > 3);
  const [open, setOpen] = useState(false);

  function clearHoverTimer(): void {
    if (hoverTimerRef.current === undefined) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = undefined;
  }

  function close(): void {
    clearHoverTimer();
    setOpen(false);
  }

  function measure(): boolean {
    const element = elementRef.current;
    const nextEnabled =
      values.length > 3 || Boolean(element && element.scrollWidth > element.clientWidth);
    setEnabled(nextEnabled);
    if (!nextEnabled) setOpen(false);
    return nextEnabled;
  }

  useLayoutEffect(() => {
    measure();
  }, [values]);

  useEffect(
    () => () => {
      clearHoverTimer();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') close();
    }
    function handleScroll(): void {
      close();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function handleMouseEnter(event: MouseEvent<HTMLElement>): void {
    children.props.onMouseEnter?.(event);
    if (!measure()) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = undefined;
      setOpen(true);
    }, delay);
  }

  function handleMouseLeave(event: MouseEvent<HTMLElement>): void {
    children.props.onMouseLeave?.(event);
    close();
  }

  function handleFocus(event: FocusEvent<HTMLElement>): void {
    children.props.onFocus?.(event);
    if (measure()) setOpen(true);
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    children.props.onBlur?.(event);
    close();
  }

  const describedBy = [children.props['aria-describedby'], open ? tooltipId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          elementRef.current = node;
          children.props.ref?.(node);
        },
        tabIndex: enabled ? (children.props.tabIndex ?? 0) : children.props.tabIndex,
        'aria-describedby': describedBy || undefined,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
      })}
      {open ? (
        <span id={tooltipId} className="event-metadata-tooltip" role="tooltip">
          {values.join('、')}
        </span>
      ) : null}
    </>
  );
}
