import type { ReactNode } from 'react';

import { PageSkeleton, type SkeletonVariant } from './PageSkeleton';
import { useDelayedVisibility } from './useDelayedVisibility';

export interface LoadingStateProps {
  pending: boolean;
  fetching: boolean;
  hasData: boolean;
  error: unknown;
  skeleton: SkeletonVariant;
  onRetry(): void;
  children: ReactNode;
}

export interface LoadingHeadingStatusProps {
  fetching: boolean;
  error: unknown;
  onRetry(): void;
}

function LoadingErrorState({
  label,
  skeleton,
  onRetry,
}: {
  label: string;
  skeleton: SkeletonVariant;
  onRetry(): void;
}) {
  return (
    <div className="loading-error-state" data-loading-variant={skeleton} role="alert">
      <strong>{label}</strong>
      <span>请确认服务连接后重试。</span>
      <button className="button button--secondary" type="button" onClick={onRetry}>
        重新加载
      </button>
    </div>
  );
}

export function LoadingHeadingStatus({ fetching, error, onRetry }: LoadingHeadingStatusProps) {
  const showUpdating = useDelayedVisibility(fetching, { delayMs: 500 });

  if (error) {
    return (
      <div className="loading-heading-status loading-heading-status--error" role="alert">
        <span>更新失败</span>
        <button type="button" onClick={onRetry}>
          重新加载
        </button>
      </div>
    );
  }

  if (!showUpdating) return null;

  return (
    <span className="loading-heading-status" role="status" aria-label="正在更新内容">
      更新中
    </span>
  );
}

export function LoadingState({
  pending,
  fetching,
  hasData,
  error,
  skeleton,
  onRetry,
  children,
}: LoadingStateProps) {
  const initialPending = pending && !hasData;
  const showInitialSkeleton = useDelayedVisibility(initialPending, {
    delayMs: 180,
    minimumVisibleMs: 300,
  });

  if (initialPending || showInitialSkeleton) {
    return <PageSkeleton variant={skeleton} visible={showInitialSkeleton} />;
  }

  if (!hasData && error) {
    return <LoadingErrorState label="加载失败" skeleton={skeleton} onRetry={onRetry} />;
  }

  return (
    <div className="loading-state-boundary">
      <LoadingHeadingStatus
        fetching={fetching && hasData}
        error={hasData ? error : null}
        onRetry={onRetry}
      />
      {children}
    </div>
  );
}
