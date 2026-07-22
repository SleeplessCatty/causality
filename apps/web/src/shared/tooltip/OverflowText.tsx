import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipMode = 'overflow' | 'always';

interface OverflowChildProps extends HTMLAttributes<HTMLElement> {
  className?: string;
  ref?: Ref<HTMLElement>;
  style?: CSSProperties;
}

interface OverflowTextProps {
  content: string;
  children: ReactElement<OverflowChildProps>;
  lines?: number;
  mode?: TooltipMode;
  delay?: number;
  disableWhenFocused?: boolean;
}

interface TooltipPosition {
  top: number;
  left: number;
  visible: boolean;
}

const tooltipGap = 8;
const viewportInset = 16;
const closeDelay = 60;

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

function isOverflowing(element: HTMLElement): boolean {
  return (
    element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
  );
}

export function OverflowText({
  content,
  children,
  lines = 1,
  mode = 'overflow',
  delay = 2_000,
  disableWhenFocused = false,
}: OverflowTextProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0, visible: false });
  const hasContent = content.length > 0;
  const enabled = hasContent && (mode === 'always' || overflowing);

  const measure = useCallback(() => {
    setOverflowing(triggerRef.current ? isOverflowing(triggerRef.current) : false);
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === undefined) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = undefined;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === undefined) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const close = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
    setPosition((current) => ({ ...current, visible: false }));
  }, [clearCloseTimer, clearOpenTimer]);

  const openAfterDelay = useCallback(() => {
    if (!enabled) return;
    if (disableWhenFocused && document.activeElement === triggerRef.current) return;
    clearOpenTimer();
    clearCloseTimer();
    if (delay === 0) {
      setOpen(true);
      return;
    }
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = undefined;
      if (!(disableWhenFocused && document.activeElement === triggerRef.current)) setOpen(true);
    }, delay);
  }, [clearCloseTimer, clearOpenTimer, delay, disableWhenFocused, enabled]);

  const closeSoon = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setOpen(false);
      setPosition((current) => ({ ...current, visible: false }));
    }, closeDelay);
  }, [clearCloseTimer, clearOpenTimer]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maximumLeft = Math.max(
      viewportInset,
      window.innerWidth - tooltipRect.width - viewportInset,
    );
    const left = Math.min(Math.max(triggerRect.left, viewportInset), maximumLeft);
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportInset;
    const top =
      spaceBelow >= tooltipRect.height + tooltipGap
        ? triggerRect.bottom + tooltipGap
        : Math.max(viewportInset, triggerRect.top - tooltipRect.height - tooltipGap);
    setPosition({ top, left, visible: true });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    measure();
    const trigger = triggerRef.current;
    const observer =
      trigger && 'ResizeObserver' in window ? new ResizeObserver(measure) : undefined;
    if (trigger) observer?.observe(trigger);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [content, lines, measure]);

  useEffect(() => {
    if (!enabled) close();
  }, [close, enabled]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') close();
    }
    function handleScroll(event: Event): void {
      if (tooltipRef.current?.contains(event.target as Node)) return;
      close();
    }
    function handleResize(): void {
      updatePosition();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [close, open, updatePosition]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearCloseTimer, clearOpenTimer],
  );

  function handleMouseEnter(event: MouseEvent<HTMLElement>): void {
    children.props.onMouseEnter?.(event);
    openAfterDelay();
  }

  function handleMouseLeave(event: MouseEvent<HTMLElement>): void {
    children.props.onMouseLeave?.(event);
    closeSoon();
  }

  function handleFocus(event: FocusEvent<HTMLElement>): void {
    children.props.onFocus?.(event);
    if (disableWhenFocused) close();
    else if (enabled) setOpen(true);
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    children.props.onBlur?.(event);
    closeSoon();
  }

  const describedBy = [children.props['aria-describedby'], open ? tooltipId : undefined]
    .filter(Boolean)
    .join(' ');
  const lineClass = lines === 1 ? 'overflow-text--single-line' : 'overflow-text--multi-line';
  const className = [children.props.className, 'overflow-text', lineClass]
    .filter(Boolean)
    .join(' ');
  const style = {
    ...children.props.style,
    ...(lines > 1 ? ({ '--overflow-text-lines': lines } as CSSProperties) : {}),
  };

  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          assignRef(children.props.ref, node);
        },
        className,
        style,
        tabIndex: enabled ? (children.props.tabIndex ?? 0) : children.props.tabIndex,
        'aria-describedby': describedBy || undefined,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
      })}
      {open && enabled
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              className="overflow-tooltip"
              role="tooltip"
              style={{
                top: position.top,
                left: position.left,
                visibility: position.visible ? 'visible' : 'hidden',
              }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={closeSoon}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
