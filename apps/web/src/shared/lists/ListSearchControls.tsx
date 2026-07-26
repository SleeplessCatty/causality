import { EnhancedSearchButton, EnhancedSearchNotice } from '../search/EnhancedSearchButton';
import type { EnhancedSearchNotice as EnhancedSearchNoticeValue } from '../search/useEnhancedListSearch';

interface ListSearchControlsProps {
  label: string;
  placeholder: string;
  value: string;
  isEnhancing: boolean;
  notice: EnhancedSearchNoticeValue | null;
  onChange(value: string): void;
  onEnhance(): void;
}

export function ListSearchControls({
  label,
  placeholder,
  value,
  isEnhancing,
  notice,
  onChange,
  onEnhance,
}: ListSearchControlsProps) {
  return (
    <>
      <div className="list-search-controls">
        <div className="event-search">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            aria-label={label}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
        </div>
        <EnhancedSearchButton isEnhancing={isEnhancing} onClick={onEnhance} />
      </div>
      <EnhancedSearchNotice notice={notice} />
    </>
  );
}
