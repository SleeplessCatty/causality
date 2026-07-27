import type {
  DataCheckActionContext,
  DataCheckActionOption,
  DataCheckActionRecord,
} from '@causality/contracts';
import { OverflowText } from '../../shared/tooltip/OverflowText';

interface DataCheckMergeDialogProps {
  context: DataCheckActionContext;
  selectedAction: DataCheckActionOption | null;
  pending: boolean;
  onSelect(action: DataCheckActionOption): void;
}

function RecordCard({ record, label }: { record: DataCheckActionRecord; label: string }) {
  return (
    <article className="data-check-record-card">
      <span className="data-check-record-card__label">{label}</span>
      <h3>{record.title}</h3>
      <OverflowText content={record.primaryText} lines={3} mode="always">
        <p>{record.primaryText}</p>
      </OverflowText>
      {record.secondaryText.length > 0 ? (
        <ul>
          {record.secondaryText.map((text, index) => (
            <li key={`${record.id}-${index}`}>
              <OverflowText content={text} lines={2} mode="always">
                <span>{text}</span>
              </OverflowText>
            </li>
          ))}
        </ul>
      ) : null}
      <small>
        {record.relationCount} 条关系 · {record.caseCount} 个案例
      </small>
    </article>
  );
}

function Impact({ action }: { action: DataCheckActionOption }) {
  const { impact } = action;
  return (
    <div className="data-check-merge-impact" role="status">
      <strong>此方向的影响</strong>
      <span>移动关系 {impact.relationsMoved} 条</span>
      <span>删除关系 {impact.relationsDeleted} 条</span>
      <span>移动关系案例关联 {impact.relationCaseLinksMoved} 条</span>
      <span>删除关系案例关联 {impact.relationCaseLinksDeleted} 条</span>
      <span>删除记录 {impact.recordsDeleted} 条</span>
    </div>
  );
}

export function DataCheckMergeDialog({
  context,
  selectedAction,
  pending,
  onSelect,
}: DataCheckMergeDialogProps) {
  const mergeActions = context.actions.filter(
    (candidate): candidate is DataCheckActionOption & { type: 'merge' } =>
      candidate.type === 'merge',
  );
  return (
    <>
      <div className="data-check-merge-records">
        {context.records.map((current, index) => (
          <RecordCard key={current.id} record={current} label={index === 0 ? '记录 A' : '记录 B'} />
        ))}
      </div>
      <fieldset className="data-check-merge-directions" disabled={pending}>
        <legend>选择合并方向</legend>
        {mergeActions.map((candidate) => (
          <label key={`${candidate.keepId}-${candidate.mergeId}`}>
            <input
              type="radio"
              name="data-check-merge-direction"
              checked={
                selectedAction?.keepId === candidate.keepId &&
                selectedAction.mergeId === candidate.mergeId
              }
              onChange={() => onSelect(candidate)}
            />
            <span>{candidate.label}</span>
          </label>
        ))}
      </fieldset>
      {selectedAction ? <Impact action={selectedAction} /> : null}
    </>
  );
}
