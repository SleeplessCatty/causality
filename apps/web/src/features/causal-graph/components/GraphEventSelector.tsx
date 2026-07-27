import type { EventCandidate } from '@causality/contracts';
import { useEffect, useState } from 'react';

import { EventCandidateCombobox } from '../../../shared/candidates/EventCandidateCombobox';

interface GraphEventSelectorProps {
  value: EventCandidate | null;
  onSelect: (event: EventCandidate) => void;
}

export function GraphEventSelector({ value, onSelect }: GraphEventSelectorProps) {
  const [input, setInput] = useState(value?.name ?? '');

  useEffect(() => setInput(value?.name ?? ''), [value]);

  return (
    <EventCandidateCombobox
      className="graph-event-selector"
      label="中心事件"
      ariaLabel="中心事件"
      value={input}
      placeholder="搜索中心事件"
      onInputChange={setInput}
      onSelect={onSelect}
    />
  );
}
