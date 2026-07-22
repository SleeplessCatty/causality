import type { EventCandidate } from '@causality/contracts';
import { useEffect, useId, useState } from 'react';

import { useExhaustiveCandidates } from '../../../shared/candidates/useExhaustiveCandidates';
import { WindowedListbox } from '../../../shared/listbox/WindowedListbox';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getEventCandidatePage } from '../../events/api/eventApi';

interface GraphEventSelectorProps {
  value: EventCandidate | null;
  onSelect: (event: EventCandidate) => void;
}

export function GraphEventSelector({ value, onSelect }: GraphEventSelectorProps) {
  const listboxId = useId();
  const [input, setInput] = useState(value?.name ?? '');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => setInput(value?.name ?? ''), [value]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(open ? input.trim() : ''), 250);
    return () => window.clearTimeout(timeout);
  }, [input, open]);

  const candidates = useExhaustiveCandidates({
    queryKey: ['events', 'candidates', 'graph-selector', query],
    query,
    enabled: open && query.length > 0,
    loadPage: (search, cursor, signal) =>
      getEventCandidatePage(search, { limit: 100, ...(cursor ? { cursor } : {}) }, signal),
    getId: (candidate: EventCandidate) => candidate.id,
  });
  const items = candidates.items;
  const expanded = open && items.length > 0;

  useEffect(() => setActiveIndex(-1), [query]);

  function select(candidate: EventCandidate): void {
    setInput(candidate.name);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(candidate);
  }

  return (
    <div className="graph-event-selector">
      <label htmlFor={`${listboxId}-input`}>中心事件</label>
      <div className="graph-event-selector__control">
        <OverflowText content={input} disableWhenFocused>
          <input
            id={`${listboxId}-input`}
            role="combobox"
            aria-label="中心事件"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={
              expanded && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            value={input}
            placeholder="搜索中心事件"
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setInput(event.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
                setActiveIndex(-1);
                return;
              }
              if (!items.length) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => (index + 1) % items.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActiveIndex(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setActiveIndex(items.length - 1);
              } else if (event.key === 'Enter' && activeIndex >= 0) {
                event.preventDefault();
                const candidate = items[activeIndex];
                if (candidate) select(candidate);
              }
            }}
          />
        </OverflowText>
        {expanded ? (
          <div className="graph-event-selector__options">
            <WindowedListbox
              id={listboxId}
              itemCount={items.length}
              itemHeight={34}
              activeIndex={activeIndex}
              className="graph-event-selector__window"
              ariaLabel="中心事件候选项"
              renderOption={(index, style) => {
                const candidate = items[index];
                if (!candidate) return null;
                return (
                  <OverflowText content={candidate.name}>
                    <button
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      style={style}
                      aria-selected={index === activeIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(candidate)}
                    >
                      {candidate.name}
                    </button>
                  </OverflowText>
                );
              }}
            />
            {candidates.isFetchingNextPage ? (
              <span className="graph-event-selector__loading">正在加载全部候选项…</span>
            ) : null}
            {candidates.nextPageError ? (
              <button
                type="button"
                className="graph-event-selector__retry"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void candidates.retryNextPage()}
              >
                加载未完成，点击重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {candidates.isInitialError && query ? (
        <span className="graph-event-selector__error" role="alert">
          无法搜索事件
        </span>
      ) : null}
    </div>
  );
}
