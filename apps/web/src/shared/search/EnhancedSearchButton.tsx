import { Link } from 'react-router';

import type { EnhancedSearchNotice as EnhancedSearchNoticeValue } from './useEnhancedListSearch';

interface EnhancedSearchButtonProps {
  isEnhancing: boolean;
  onClick(): void;
}

export function EnhancedSearchButton({ isEnhancing, onClick }: EnhancedSearchButtonProps) {
  return (
    <button
      className="button button--secondary enhanced-search-button"
      type="button"
      disabled={isEnhancing}
      aria-label={isEnhancing ? '增强查询中…' : '增强查询'}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25L12 3Z" />
        <path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      </svg>
      <span>{isEnhancing ? '查询中…' : '增强查询'}</span>
    </button>
  );
}

export function EnhancedSearchNotice({ notice }: { notice: EnhancedSearchNoticeValue | null }) {
  if (!notice) return null;

  return (
    <div
      className={`enhanced-search-notice enhanced-search-notice--${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.message}</span>
      {notice.settingsLink ? <Link to="/settings">前往参数配置</Link> : null}
    </div>
  );
}
