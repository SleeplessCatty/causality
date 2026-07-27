import type { EventCandidate } from '@causality/contracts';
import { useEffect, useId, useMemo, useState } from 'react';

import { getEventCandidatePage } from '../../features/events/api/eventApi';
import { WindowedListbox } from '../listbox/WindowedListbox';
import { OverflowText } from '../tooltip/OverflowText';
import { useExhaustiveCandidates } from './useExhaustiveCandidates';

export interface EventCandidateComboboxProps {
  label: string;
  ariaLabel: string;
  value: string;
  excludedIds?: ReadonlySet<string>;
  className?: string;
  placeholder: string;
  onInputChange(value: string): void;
  onSelect(candidate: EventCandidate): void;
}

export function EventCandidateCombobox({
  label,
  ariaLabel,
  value,
  excludedIds,
  className,
  placeholder,
  onInputChange,
  onSelect,
}: EventCandidateComboboxProps) {
  const listboxId = useId();
  const inputId = `${listboxId}-input`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(open ? value.trim() : ''), 250);
    return () => window.clearTimeout(timeout);
  }, [open, value]);

  const candidates = useExhaustiveCandidates({
    queryKey: ['events', 'candidates', 'event-candidate-combobox', ariaLabel],
    query,
    enabled: open && query.length > 0,
    loadPage: (search, cursor, signal) =>
      getEventCandidatePage(search, { limit: 100, ...(cursor ? { cursor } : {}) }, signal),
  });
  const items = useMemo(
    () =>
      excludedIds
        ? candidates.items.filter((candidate) => !excludedIds.has(candidate.id))
        : candidates.items,
    [candidates.items, excludedIds],
  );
  const expanded = open && items.length > 0;

  useEffect(() => setActiveIndex(-1), [query]);

  function select(candidate: EventCandidate): void {
    onInputChange(candidate.name);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(candidate);
  }

  return (
    <div className={['event-candidate-combobox', className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId}>{label}</label>
      <div className="event-candidate-combobox__control">
        <OverflowText content={value} disableWhenFocused>
          <input
            id={inputId}
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={
              expanded && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              onInputChange(event.target.value);
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
          <div className="event-candidate-combobox__options">
            <WindowedListbox
              id={listboxId}
              itemCount={items.length}
              itemHeight={34}
              activeIndex={activeIndex}
              className="event-candidate-combobox__window"
              ariaLabel={`${label}候选项`}
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
              <span className="event-candidate-combobox__loading">正在加载全部候选项…</span>
            ) : null}
            {candidates.nextPageError ? (
              <button
                type="button"
                className="event-candidate-combobox__retry"
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
        <span className="event-candidate-combobox__error" role="alert">
          无法搜索事件
        </span>
      ) : null}
    </div>
  );
}
