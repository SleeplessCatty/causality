interface DataCheckActionErrorProps {
  message: string;
  stale?: boolean;
  onRetry?: () => void;
}

export function DataCheckActionError({
  message,
  stale = false,
  onRetry,
}: DataCheckActionErrorProps) {
  return (
    <div
      className={`data-check-action-error${stale ? ' data-check-action-error--stale' : ''}`}
      role="alert"
    >
      <span>{stale ? `${message} 请使用页面顶部的“检查数据”重新检查后再处理。` : message}</span>
      {!stale && onRetry ? (
        <button className="text-button" type="button" onClick={onRetry}>
          重新加载
        </button>
      ) : null}
    </div>
  );
}
