import type { EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getEventCandidates } from '../../events/api/eventApi';

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

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(open ? input.trim() : ''), 250);
    return () => window.clearTimeout(timeout);
  }, [input, open]);

  const candidates = useQuery({
    queryKey: ['events', 'candidates', 'relation-selector', query],
    queryFn: ({ signal }) => getEventCandidates(query, { limit: 8 }, signal),
    enabled: query.length > 0,
  });

  function select(candidate: EventCandidate): void {
    onChange(candidate);
    setInput(candidate.name);
    setOpen(false);
  }

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
          aria-expanded={open && Boolean(candidates.data?.length)}
          aria-controls={`${id}-options`}
          aria-invalid={Boolean(error)}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            onChange(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="输入名称或别名查找已有事件"
          autoFocus={autoFocus}
        />
        {open && candidates.data && candidates.data.length > 0 ? (
          <div className="event-selector__options" id={`${id}-options`} role="listbox">
            {candidates.data.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={value?.id === candidate.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(candidate)}
              >
                {candidate.name}
              </button>
            ))}
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
