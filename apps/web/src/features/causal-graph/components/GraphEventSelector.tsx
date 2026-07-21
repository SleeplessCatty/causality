import type { EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { getEventCandidates } from '../../events/api/eventApi';

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

  const candidates = useQuery({
    queryKey: ['events', 'candidates', 'graph-selector', query],
    queryFn: ({ signal }) => getEventCandidates(query, { limit: 8 }, signal),
    enabled: open && query.length > 0,
  });
  const items = candidates.data ?? [];
  const expanded = open && items.length > 0;

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
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              const candidate = items[activeIndex];
              if (candidate) select(candidate);
            }
          }}
        />
        {expanded ? (
          <div className="graph-event-selector__options" id={listboxId} role="listbox">
            {items.map((candidate, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(candidate)}
              >
                {candidate.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {candidates.isError && query ? (
        <span className="graph-event-selector__error" role="alert">
          无法搜索事件
        </span>
      ) : null}
    </div>
  );
}
