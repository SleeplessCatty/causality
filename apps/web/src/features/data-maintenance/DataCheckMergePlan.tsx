import type {
  DataCheckActionContext,
  DataCheckActionOption,
  DataCheckActionRecord,
} from '@causality/contracts';
import { OverflowText } from '../../shared/tooltip/OverflowText';
import { DataCheckActionImpactView } from './DataCheckActionPlan';

interface DataCheckMergePlanProps {
  context: DataCheckActionContext;
  selectedAction: DataCheckActionOption | null;
  disabled: boolean;
  onSelect(action: DataCheckActionOption): void;
}

function RecordCard({ record, label }: { record: DataCheckActionRecord; label: string }) {
  return (
    <article className="data-check-record-card">
      <span className="data-check-record-card__label">{label}</span>
      <h5>{record.title}</h5>
      <OverflowText content={record.primaryText} lines={2} mode="always">
        <p>{record.primaryText}</p>
      </OverflowText>
      {record.secondaryText.length > 0 ? (
        <ul>
          {record.secondaryText.map((text, index) => (
            <li key={`${record.id}-${index}`}>
              <OverflowText content={text} lines={1} mode="always">
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

export function DataCheckMergePlan({
  context,
  selectedAction,
  disabled,
  onSelect,
}: DataCheckMergePlanProps) {
  const actions = context.actions.filter(
    (candidate): candidate is DataCheckActionOption & { type: 'merge' } =>
      candidate.type === 'merge',
  );

  return (
    <section className="data-check-action-plan data-check-merge-plan" aria-label="处理方案">
      <h4>处理方案</h4>
      <div className="data-check-merge-records">
        {context.records.map((record, index) => (
          <RecordCard record={record} label={index === 0 ? '记录 A' : '记录 B'} key={record.id} />
        ))}
      </div>
      <fieldset className="data-check-merge-directions" disabled={disabled}>
        <legend>选择合并方向</legend>
        {actions.map((candidate) => (
          <label key={`${candidate.keepId}-${candidate.mergeId}`}>
            <input
              type="radio"
              name={`data-check-merge-direction-${context.issueId}`}
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
      {selectedAction ? <DataCheckActionImpactView action={selectedAction} /> : null}
    </section>
  );
}
