export type SkeletonVariant = 'list' | 'detail' | 'form' | 'settings' | 'canvas';

export interface PageSkeletonProps {
  variant: SkeletonVariant;
  visible?: boolean;
}

const skeletonLabels: Record<SkeletonVariant, string> = {
  list: '正在准备列表页面',
  detail: '正在准备详情页面',
  form: '正在准备表单页面',
  settings: '正在准备设置页面',
  canvas: '正在准备画布页面',
};

function SkeletonBlock({ className }: { className: string }) {
  return <span className={`page-skeleton__block ${className}`} aria-hidden="true" />;
}

function ListSkeleton() {
  return (
    <>
      <SkeletonBlock className="page-skeleton__title" />
      <SkeletonBlock className="page-skeleton__subtitle" />
      <SkeletonBlock className="page-skeleton__toolbar" />
      <div className="page-skeleton__table" aria-hidden="true">
        <SkeletonBlock className="page-skeleton__table-heading" />
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonBlock key={index} className="page-skeleton__table-row" />
        ))}
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <SkeletonBlock className="page-skeleton__back" />
      <SkeletonBlock className="page-skeleton__title" />
      <div className="page-skeleton__summary" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="page-skeleton__summary-cell" />
        ))}
      </div>
      <SkeletonBlock className="page-skeleton__tabs" />
      <div className="page-skeleton__table" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="page-skeleton__table-row" />
        ))}
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <>
      <SkeletonBlock className="page-skeleton__title" />
      <SkeletonBlock className="page-skeleton__subtitle" />
      <div className="page-skeleton__form" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="page-skeleton__field" />
        ))}
        <SkeletonBlock className="page-skeleton__form-actions" />
      </div>
    </>
  );
}

function SettingsSkeleton() {
  return (
    <>
      <SkeletonBlock className="page-skeleton__title" />
      <SkeletonBlock className="page-skeleton__subtitle" />
      <div className="page-skeleton__settings" aria-hidden="true">
        <SkeletonBlock className="page-skeleton__settings-panel" />
        <div className="page-skeleton__settings-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock key={index} className="page-skeleton__settings-card" />
          ))}
        </div>
      </div>
    </>
  );
}

function CanvasSkeleton() {
  return (
    <>
      <SkeletonBlock className="page-skeleton__canvas-toolbar" />
      <div className="page-skeleton__canvas-nodes" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} className="page-skeleton__canvas-node" />
        ))}
      </div>
    </>
  );
}

export function PageSkeleton({ variant, visible = true }: PageSkeletonProps) {
  return (
    <div
      className={`page-skeleton${visible ? '' : ' page-skeleton--hidden'}`}
      data-skeleton-variant={variant}
      role="status"
      aria-label={skeletonLabels[variant]}
      aria-live="polite"
      aria-hidden={visible ? undefined : true}
    >
      {variant === 'list' ? <ListSkeleton /> : null}
      {variant === 'detail' ? <DetailSkeleton /> : null}
      {variant === 'form' ? <FormSkeleton /> : null}
      {variant === 'settings' ? <SettingsSkeleton /> : null}
      {variant === 'canvas' ? <CanvasSkeleton /> : null}
    </div>
  );
}
