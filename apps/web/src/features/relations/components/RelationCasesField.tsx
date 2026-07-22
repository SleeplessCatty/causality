import { useEffect, useRef, useState } from 'react';

import { CaseSelectorRow } from './CaseSelectorRow';

export type RelationCaseSelectionValue =
  { type: 'existing'; caseId: string; content: string } | { type: 'new'; content: string };

interface CaseRow {
  key: number;
  query: string;
  selection?: RelationCaseSelectionValue;
  error?: string | undefined;
}

interface RelationCasesFieldProps {
  value: RelationCaseSelectionValue[];
  onChange: (value: RelationCaseSelectionValue[]) => void;
  onIncompleteChange: (incomplete: boolean) => void;
  error?: string | undefined;
  disabled?: boolean;
  maxRows?: number;
}

function selectionKey(selection: RelationCaseSelectionValue): string {
  return selection.type === 'existing'
    ? `existing:${selection.caseId}`
    : `new:${selection.content.trim()}`;
}

export function RelationCasesField({
  value,
  onChange,
  onIncompleteChange,
  error,
  disabled = false,
  maxRows,
}: RelationCasesFieldProps) {
  const nextKey = useRef(value.length);
  const [rows, setRows] = useState<CaseRow[]>(() =>
    value.map((selection, key) => ({ key, query: selection.content, selection })),
  );
  const rowsRef = useRef(rows);
  const isAtRowLimit = maxRows !== undefined && rows.length >= maxRows;
  const visibleError = isAtRowLimit ? `单条因果关系最多关联 ${maxRows} 条具体案例` : error;

  useEffect(() => {
    onIncompleteChange(rows.some((row) => !row.selection));
  }, [onIncompleteChange, rows]);

  function emit(nextRows: CaseRow[]): void {
    onChange(nextRows.flatMap((row) => (row.selection ? [row.selection] : [])));
  }

  function commit(nextRows: CaseRow[]): void {
    rowsRef.current = nextRows;
    setRows(nextRows);
    emit(nextRows);
  }

  function addRow(): void {
    if (maxRows !== undefined && rowsRef.current.length >= maxRows) return;
    commit([...rowsRef.current, { key: nextKey.current++, query: '' }]);
  }

  function changeQuery(key: number, query: string): void {
    commit(rowsRef.current.map((row) => (row.key === key ? { key: row.key, query } : row)));
  }

  function selectRow(key: number, selection: RelationCaseSelectionValue): void {
    const duplicate = rowsRef.current.some(
      (row) =>
        row.key !== key && row.selection && selectionKey(row.selection) === selectionKey(selection),
    );
    commit(
      rowsRef.current.map((row) =>
        row.key === key
          ? duplicate
            ? { ...row, error: '同一关系不能重复选择案例' }
            : { key: row.key, query: selection.content, selection }
          : row,
      ),
    );
  }

  function removeRow(key: number): void {
    commit(rowsRef.current.filter((row) => row.key !== key));
  }

  return (
    <fieldset className="relation-cases-field" disabled={disabled}>
      <legend>具体案例</legend>
      <div className="relation-cases-field__heading">
        <p>关联真实发生的事件，用于验证这条因果关系。</p>
      </div>
      {rows.length > 0 ? (
        <div className="relation-cases-field__rows">
          {rows.map((row, index) => (
            <CaseSelectorRow
              key={row.key}
              index={index}
              query={row.query}
              selection={row.selection}
              error={row.error}
              disabled={disabled}
              onQueryChange={(query) => changeQuery(row.key, query)}
              onSelect={(selection) => selectRow(row.key, selection)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </div>
      ) : (
        <p className="relation-cases-field__empty">尚未关联具体案例，可稍后添加。</p>
      )}
      {visibleError ? (
        <span className="field-error" role="alert">
          {visibleError}
        </span>
      ) : null}
      <div className="relation-cases-field__actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={addRow}
          disabled={disabled || isAtRowLimit}
        >
          添加案例
        </button>
      </div>
    </fieldset>
  );
}
