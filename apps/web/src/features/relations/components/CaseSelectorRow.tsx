import type { CaseReference } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { getCaseCandidates } from '../../cases/api/caseApi';
import type { RelationCaseSelectionValue } from './RelationCasesField';

interface CaseSelectorRowProps {
  index: number;
  query: string;
  selection?: RelationCaseSelectionValue | undefined;
  error?: string | undefined;
  disabled?: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (selection: RelationCaseSelectionValue) => void;
  onRemove: () => void;
}

export function CaseSelectorRow({
  index,
  query,
  selection,
  error,
  disabled = false,
  onQueryChange,
  onSelect,
  onRemove,
}: CaseSelectorRowProps) {
  const [candidateQuery, setCandidateQuery] = useState(query.trim());
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setCandidateQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['cases', 'candidates', candidateQuery],
    queryFn: ({ signal }) => getCaseCandidates(candidateQuery, signal),
    enabled: candidateQuery.length > 0 && candidateQuery.length <= 50 && !selection,
  });
  const normalizedQuery = query.trim();
  const lengthError = normalizedQuery.length > 50 ? '案例内容不能超过 50 字' : undefined;
  const visibleError = error ?? lengthError;
  const mayCreate =
    !selection &&
    normalizedQuery.length > 0 &&
    normalizedQuery.length <= 50 &&
    candidates.isSuccess &&
    !candidates.data.some((candidate) => candidate.content === normalizedQuery);
  const options = useMemo(
    () => [
      ...(candidates.data ?? []).map((candidate) => ({ type: 'existing' as const, candidate })),
      ...(mayCreate ? [{ type: 'new' as const, content: normalizedQuery }] : []),
    ],
    [candidates.data, mayCreate, normalizedQuery],
  );
  const showOptions = isFocused && !selection && options.length > 0;

  function chooseExisting(candidate: CaseReference): void {
    onSelect({ type: 'existing', caseId: candidate.id, content: candidate.content });
  }

  function chooseFirstOption(): void {
    const first = options[0];
    if (!first) return;
    if (first.type === 'existing') chooseExisting(first.candidate);
    else onSelect({ type: 'new', content: first.content });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if ((event.key === 'ArrowDown' || event.key === 'Enter') && options.length > 0) {
      event.preventDefault();
      if (event.key === 'Enter') chooseFirstOption();
      else setIsFocused(true);
    }
    if (event.key === 'Escape') setIsFocused(false);
  }

  return (
    <div className="case-selector-row">
      <div className="case-selector-row__number" aria-hidden="true">
        {index + 1}
      </div>
      <div className="event-selector__control case-selector-row__control">
        <input
          role="combobox"
          aria-label={`具体案例 ${index + 1}`}
          aria-autocomplete="list"
          aria-expanded={showOptions}
          aria-controls={`relation-case-${index}-options`}
          aria-invalid={Boolean(visibleError)}
          value={query}
          disabled={disabled}
          placeholder="输入案例内容进行搜索"
          onFocus={() => setIsFocused(true)}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 100)}
          onChange={(event) => {
            setIsFocused(true);
            onQueryChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        {showOptions ? (
          <div
            id={`relation-case-${index}-options`}
            className="event-selector__options case-selector-row__options"
            role="listbox"
          >
            {options.map((option) =>
              option.type === 'existing' ? (
                <button
                  key={option.candidate.id}
                  role="option"
                  aria-selected="false"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseExisting(option.candidate)}
                >
                  {option.candidate.content}
                </button>
              ) : (
                <button
                  key={`new:${option.content}`}
                  role="option"
                  aria-selected="false"
                  type="button"
                  className="case-selector-row__create-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect({ type: 'new', content: option.content })}
                >
                  创建新案例：{option.content}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
      {selection ? (
        <span className="case-selector-row__status">
          {selection.type === 'existing' ? '已有案例' : '新案例'}
        </span>
      ) : null}
      <button
        className="case-selector-row__remove"
        type="button"
        aria-label="移除案例"
        disabled={disabled}
        onClick={onRemove}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M5 10h10" />
        </svg>
      </button>
      {visibleError ? (
        <span className="field-error case-selector-row__error" role="alert">
          {visibleError}
        </span>
      ) : null}
    </div>
  );
}
