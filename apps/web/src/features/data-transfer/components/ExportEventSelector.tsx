import type { EventCandidate } from '@causality/contracts';
import { useMemo, useState } from 'react';

import { EventCandidateCombobox } from '../../../shared/candidates/EventCandidateCombobox';
import { OverflowText } from '../../../shared/tooltip/OverflowText';

interface ExportEventSelectorProps {
  selected: readonly EventCandidate[];
  onChange(selected: EventCandidate[]): void;
}

export function ExportEventSelector({ selected, onChange }: ExportEventSelectorProps) {
  const [draft, setDraft] = useState('');
  const excludedIds = useMemo(() => new Set(selected.map((event) => event.id)), [selected]);

  function addEvent(event: EventCandidate): void {
    setDraft('');
    if (excludedIds.has(event.id)) return;
    onChange([...selected, event]);
  }

  return (
    <div className="data-transfer-export-events">
      <EventCandidateCombobox
        label="起始事件"
        ariaLabel="搜索起始原子事件"
        value={draft}
        excludedIds={excludedIds}
        placeholder="输入名称搜索原子事件"
        onInputChange={setDraft}
        onSelect={addEvent}
      />
      {selected.length > 0 ? (
        <ul className="data-transfer-export-chips" aria-label="已选起始原子事件">
          {selected.map((event) => (
            <li key={event.id}>
              <OverflowText content={event.name}>
                <span className="data-transfer-export-chip-name">{event.name}</span>
              </OverflowText>
              <button
                type="button"
                aria-label={`移除起始原子事件：${event.name}`}
                onClick={() => onChange(selected.filter((candidate) => candidate.id !== event.id))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="data-transfer-export-empty-events">至少选择一个起始原子事件。</p>
      )}
    </div>
  );
}
