import { useState, type KeyboardEvent } from 'react';

export interface ListPaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  disabled?: boolean;
  onPageChange(page: number): void;
}

type PageItem = number | 'ellipsis';

export function readListPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
}

function visiblePages(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages]);
  for (let candidate = page - 2; candidate <= page + 2; candidate += 1) {
    if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
  }
  const sorted = [...pages].sort((left, right) => left - right);
  const items: PageItem[] = [];
  sorted.forEach((candidate, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && candidate - previous > 1) items.push('ellipsis');
    items.push(candidate);
  });
  return items;
}

export function ListPagination({
  page,
  totalPages,
  totalItems,
  disabled = false,
  onPageChange,
}: ListPaginationProps) {
  const [jumpValue, setJumpValue] = useState('');

  function jump(): void {
    if (!/^\d+$/.test(jumpValue)) return;
    const target = Number(jumpValue);
    if (!Number.isSafeInteger(target) || target < 1 || target > totalPages) return;
    onPageChange(target);
  }

  function handleJumpKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') jump();
  }

  return (
    <nav className="pagination" aria-label="列表分页">
      <span className="pagination__summary">
        共 {totalItems} 条 · 第 {page}/{totalPages} 页
      </span>
      <div className="pagination__pages">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          上一页
        </button>
        {visiblePages(page, totalPages).map((item, index) =>
          item === 'ellipsis' ? (
            <span className="pagination__ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>
              …
            </span>
          ) : (
            <button
              className="pagination__page"
              type="button"
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? 'page' : undefined}
              disabled={disabled}
              onClick={() => onPageChange(item)}
              key={item}
            >
              {item}
            </button>
          ),
        )}
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          下一页
        </button>
      </div>
      <label className="pagination__jump">
        <span>跳至</span>
        <input
          aria-label="跳转页码"
          type="number"
          min="1"
          max={totalPages}
          step="1"
          value={jumpValue}
          disabled={disabled}
          onChange={(event) => setJumpValue(event.target.value)}
          onKeyDown={handleJumpKeyDown}
        />
        <span>页</span>
        <button
          className="button button--secondary"
          type="button"
          aria-label="跳转"
          disabled={disabled}
          onClick={jump}
        >
          跳转
        </button>
      </label>
    </nav>
  );
}
