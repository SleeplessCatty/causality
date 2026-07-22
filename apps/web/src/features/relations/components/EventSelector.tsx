import type { EventCandidate } from '@causality/contracts';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { getEventCandidatePage } from '../../events/api/eventApi';
import { useExhaustiveCandidates } from '../../../shared/candidates/useExhaustiveCandidates';
import { WindowedListbox } from '../../../shared/listbox/WindowedListbox';

interface EventSelectorProps {
  id: string;
  label: string;
  value: EventCandidate | null;
  error?: string | undefined;
  onChange: (value: EventCandidate | null) => void;
  autoFocus?: boolean;
}

export function EventSelector({
  id,
  label,
  value,
  error,
  onChange,
  autoFocus,
}: EventSelectorProps) {
  const [input, setInput] = useState(value?.name ?? '');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(open ? input.trim() : ''), 250);
    return () => window.clearTimeout(timeout);
  }, [input, open]);

  const candidates = useExhaustiveCandidates({
    queryKey: ['events', 'candidates', 'relation-selector', query],
    query,
    enabled: open && query.length > 0,
    loadPage: (search, cursor, signal) =>
      getEventCandidatePage(search, { limit: 100, ...(cursor ? { cursor } : {}) }, signal),
    getId: (candidate: EventCandidate) => candidate.id,
  });

  useEffect(() => setActiveIndex(-1), [query]);

  function select(candidate: EventCandidate): void {
    onChange(candidate);
    setInput(candidate.name);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || candidates.items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index >= candidates.items.length - 1 ? 0 : index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? candidates.items.length - 1 : index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(candidates.items.length - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const candidate = candidates.items[activeIndex];
      if (candidate) select(candidate);
    }
  }

  const showOptions = open && candidates.items.length > 0;

  return (
    <div className="form-field event-selector">
      <label htmlFor={id}>
        {label} <span aria-hidden="true">*</span>
      </label>
      <div className="event-selector__control">
        <input
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={showOptions}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-option-${candidates.items[activeIndex]?.id}` : undefined
          }
          aria-invalid={Boolean(error)}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            onChange(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="输入名称或别名查找已有事件"
          autoFocus={autoFocus}
        />
        {showOptions ? (
          <div className="event-selector__options">
            <WindowedListbox
              id={`${id}-options`}
              itemCount={candidates.items.length}
              itemHeight={36}
              activeIndex={activeIndex}
              ariaLabel={`${label}候选项`}
              renderOption={(index, style) => {
                const candidate = candidates.items[index];
                if (!candidate) return null;
                return (
                  <button
                    id={`${id}-option-${candidate.id}`}
                    type="button"
                    role="option"
                    style={style}
                    aria-selected={activeIndex === index || value?.id === candidate.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(candidate)}
                  >
                    {candidate.name}
                  </button>
                );
              }}
            />
            {candidates.isFetchingNextPage ? (
              <div className="candidate-list__status">正在加载全部候选项…</div>
            ) : null}
            {candidates.nextPageError ? (
              <button
                className="candidate-list__retry"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void candidates.retryNextPage()}
              >
                加载未完成，点击重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
