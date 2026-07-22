import type { CaseReference } from '@causality/contracts';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { getCaseCandidatePage } from '../../cases/api/caseApi';
import { useExhaustiveCandidates } from '../../../shared/candidates/useExhaustiveCandidates';
import { WindowedListbox } from '../../../shared/listbox/WindowedListbox';
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
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timeout = window.setTimeout(() => setCandidateQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const candidates = useExhaustiveCandidates({
    queryKey: ['cases', 'candidates', candidateQuery],
    query: candidateQuery,
    enabled: isFocused && candidateQuery.length > 0 && candidateQuery.length <= 100 && !selection,
    loadPage: (search, cursor, signal) =>
      getCaseCandidatePage(search, { limit: 100, ...(cursor ? { cursor } : {}) }, signal),
    getId: (candidate: CaseReference) => candidate.id,
  });
  useEffect(() => setActiveIndex(-1), [candidateQuery]);
  const normalizedQuery = query.trim();
  const lengthError = normalizedQuery.length > 100 ? '案例内容不能超过 100 字' : undefined;
  const visibleError = error ?? lengthError;
  const mayCreate =
    !selection &&
    normalizedQuery.length > 0 &&
    normalizedQuery.length <= 100 &&
    candidates.hasLoadedPage &&
    !candidates.items.some((candidate) => candidate.content === normalizedQuery);
  const options = useMemo(
    () => [
      ...(mayCreate ? [{ type: 'new' as const, content: normalizedQuery }] : []),
      ...candidates.items.map((candidate) => ({ type: 'existing' as const, candidate })),
    ],
    [candidates.items, mayCreate, normalizedQuery],
  );
  const showOptions = isFocused && !selection && options.length > 0;

  function chooseExisting(candidate: CaseReference): void {
    onSelect({ type: 'existing', caseId: candidate.id, content: candidate.content });
  }

  function chooseOption(optionIndex: number): void {
    const option = options[optionIndex];
    if (!option) return;
    if (option.type === 'existing') chooseExisting(option.candidate);
    else onSelect({ type: 'new', content: option.content });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setIsFocused(false);
      return;
    }
    if (options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsFocused(true);
      setActiveIndex((optionIndex) => (optionIndex >= options.length - 1 ? 0 : optionIndex + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((optionIndex) => (optionIndex <= 0 ? options.length - 1 : optionIndex - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseOption(activeIndex >= 0 ? activeIndex : 0);
    }
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
          aria-activedescendant={
            activeIndex >= 0 ? `relation-case-${index}-option-${activeIndex}` : undefined
          }
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
          <div className="event-selector__options case-selector-row__options">
            <WindowedListbox
              id={`relation-case-${index}-options`}
              itemCount={options.length}
              itemHeight={38}
              activeIndex={activeIndex}
              className="case-selector-row__window is-above"
              ariaLabel={`具体案例 ${index + 1} 候选项`}
              renderOption={(optionIndex, style) => {
                const option = options[optionIndex];
                if (!option) return null;
                return option.type === 'existing' ? (
                  <button
                    id={`relation-case-${index}-option-${optionIndex}`}
                    role="option"
                    aria-selected={activeIndex === optionIndex}
                    type="button"
                    style={style}
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseExisting(option.candidate)}
                  >
                    {option.candidate.content}
                  </button>
                ) : (
                  <button
                    id={`relation-case-${index}-option-${optionIndex}`}
                    role="option"
                    aria-selected={activeIndex === optionIndex}
                    type="button"
                    style={style}
                    className="case-selector-row__create-option"
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect({ type: 'new', content: option.content })}
                  >
                    创建新案例：{option.content}
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
