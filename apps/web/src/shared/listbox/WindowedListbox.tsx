import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from 'react';

interface WindowedListboxProps {
  id: string;
  itemCount: number;
  itemHeight: number;
  activeIndex: number;
  className?: string;
  ariaLabel?: string;
  renderOption: (index: number, style: CSSProperties) => ReactNode;
}

const maximumHeight = 230;
const overscan = 4;

export function WindowedListbox({
  id,
  itemCount,
  itemHeight,
  activeIndex,
  className,
  ariaLabel,
  renderOption,
}: WindowedListboxProps) {
  const initialScrollTop =
    activeIndex >= 0 ? Math.max(0, activeIndex * itemHeight - itemHeight * overscan) : 0;
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const listboxRef = useRef<HTMLDivElement>(null);
  const viewportHeight = Math.min(maximumHeight, itemCount * itemHeight);

  useEffect(() => {
    if (activeIndex < 0) return;
    const itemTop = activeIndex * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const currentBottom = scrollTop + viewportHeight;
    let nextScrollTop = scrollTop;

    if (itemTop < scrollTop) nextScrollTop = itemTop;
    else if (itemBottom > currentBottom) nextScrollTop = itemBottom - viewportHeight;

    if (nextScrollTop !== scrollTop) {
      setScrollTop(nextScrollTop);
      if (listboxRef.current) listboxRef.current.scrollTop = nextScrollTop;
    }
  }, [activeIndex, itemHeight, scrollTop, viewportHeight]);

  const firstIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const lastIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan,
  );
  const visibleIndexes = Array.from(
    { length: Math.max(0, lastIndex - firstIndex) },
    (_, offset) => firstIndex + offset,
  );

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    setScrollTop(event.currentTarget.scrollTop);
  }

  return (
    <div
      ref={listboxRef}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      className={className}
      onScroll={handleScroll}
      style={{ height: viewportHeight, maxHeight: maximumHeight, overflowY: 'auto' }}
    >
      <div style={{ position: 'relative', height: itemCount * itemHeight }}>
        {visibleIndexes.map((index) => (
          <Fragment key={index}>
            {renderOption(index, {
              position: 'absolute',
              top: index * itemHeight,
              right: 0,
              left: 0,
              height: itemHeight,
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
