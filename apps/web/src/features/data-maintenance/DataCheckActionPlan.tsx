import type { DataCheckActionImpact, DataCheckActionOption } from '@causality/contracts';

interface DataCheckActionPlanProps {
  action: DataCheckActionOption;
}

interface DataCheckPanelActionsProps {
  showConfirm: boolean;
  confirmAction: DataCheckActionOption | null;
  ignoreAction: DataCheckActionOption | null;
  pending: boolean;
  disabled: boolean;
  onApply(action: DataCheckActionOption): void;
}

const impactLabels: ReadonlyArray<readonly [keyof DataCheckActionImpact, string]> = [
  ['relationsMoved', '移动关系'],
  ['relationsDeleted', '删除关系'],
  ['relationCaseLinksMoved', '移动关系案例关联'],
  ['relationCaseLinksDeleted', '删除关系案例关联'],
  ['recordsDeleted', '删除记录'],
  ['recordsUpdated', '更新记录'],
];

export function DataCheckActionImpactView({
  action,
}: {
  action: DataCheckActionOption;
}) {
  const visibleImpacts = impactLabels.filter(([key]) => action.impact[key] > 0);
  return (
    <div className="data-check-action-impact" role="status">
      {visibleImpacts.length > 0 ? (
        visibleImpacts.map(([key, label]) => (
          <span key={key}>
            {label} {action.impact[key]} 条
          </span>
        ))
      ) : (
        <span>不会修改其他业务记录</span>
      )}
    </div>
  );
}

export function DataCheckActionPlan({ action }: DataCheckActionPlanProps) {
  return (
    <section
      className={`data-check-action-plan${
        action.type === 'delete_relation' ? ' data-check-action-plan--danger' : ''
      }`}
      aria-label="处理方案"
    >
      <h4>处理方案</h4>
      <strong>{action.label}</strong>
      <DataCheckActionImpactView action={action} />
    </section>
  );
}

export function DataCheckPanelActions({
  showConfirm,
  confirmAction,
  ignoreAction,
  pending,
  disabled,
  onApply,
}: DataCheckPanelActionsProps) {
  if (!showConfirm && !ignoreAction) return null;
  return (
    <div className="data-check-panel-actions">
      {showConfirm ? (
        <button
          className="button button--primary"
          type="button"
          disabled={disabled || pending || !confirmAction}
          onClick={() => confirmAction && onApply(confirmAction)}
        >
          {pending ? '处理中…' : '确认处理'}
        </button>
      ) : null}
      {ignoreAction ? (
        <button
          className="button button--secondary"
          type="button"
          disabled={disabled || pending}
          onClick={() => onApply(ignoreAction)}
        >
          {!showConfirm && pending ? '处理中…' : '忽略此问题'}
        </button>
      ) : null}
    </div>
  );
}
