import {
  cloneElement,
  useEffect,
  useId,
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
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const enabled = values.length > 0;

  function clearHoverTimer(): void {
    if (hoverTimerRef.current === undefined) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = undefined;
  }

  function close(): void {
    clearHoverTimer();
    setOpen(false);
  }

  useEffect(
    () => () => {
      clearHoverTimer();
    },
    [],
  );

  useEffect(() => {
    if (!enabled) close();
  }, [enabled]);

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
    if (!enabled) return;
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
    if (enabled) setOpen(true);
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
