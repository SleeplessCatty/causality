import {
  relationFormInputSchema,
  type EventCandidate,
  type RelationFormInput,
} from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { useAutoDismissError } from '../../../shared/forms/useAutoDismissError';
import { ApiClientError } from '../../events/api/eventApi';
import { checkRelationPair } from '../api/relationApi';
import { EventSelector } from './EventSelector';
import { RelationCasesField, type RelationCaseSelectionValue } from './RelationCasesField';

export interface RelationFormValue {
  causeEvent: EventCandidate | null;
  effectEvent: EventCandidate | null;
  confidence: number | null;
  description: string | null;
  caseSelections: RelationCaseSelectionValue[];
}

interface RelationFormProps {
  mode: 'create' | 'edit';
  initialValue: RelationFormValue;
  relationId?: string;
  onSubmit: (value: RelationFormInput) => Promise<unknown>;
  cancelTo: string;
}

export function RelationForm({
  mode,
  initialValue,
  relationId,
  onSubmit,
  cancelTo,
}: RelationFormProps) {
  const [causeEvent, setCauseEvent] = useState(initialValue.causeEvent);
  const [effectEvent, setEffectEvent] = useState(initialValue.effectEvent);
  const [confidence, setConfidence] = useState<number | null>(initialValue.confidence);
  const [description, setDescription] = useState(initialValue.description ?? '');
  const [caseSelections, setCaseSelections] = useState(initialValue.caseSelections);
  const [casesIncomplete, setCasesIncomplete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useAutoDismissError(
    Boolean(formError) || Object.keys(fieldErrors).length > 0,
    errorRevision,
    () => {
      setFieldErrors({});
      setFormError(undefined);
    },
  );

  const pair = useQuery({
    queryKey: [
      'relations',
      'pair-check',
      causeEvent?.id ?? null,
      effectEvent?.id ?? null,
      relationId ?? null,
    ],
    queryFn: ({ signal }) => checkRelationPair(causeEvent!.id, effectEvent!.id, relationId, signal),
    enabled: Boolean(causeEvent && effectEvent && causeEvent.id !== effectEvent.id),
  });
  const handleCasesIncomplete = useCallback((incomplete: boolean) => {
    setCasesIncomplete(incomplete);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldErrors({});
    setFormError(undefined);
    const raw = {
      causeEventId: causeEvent?.id ?? '',
      effectEventId: effectEvent?.id ?? '',
      confidence,
      description,
      caseSelections: caseSelections.map((selection) =>
        selection.type === 'existing'
          ? { type: 'existing' as const, caseId: selection.caseId }
          : { type: 'new' as const, content: selection.content },
      ),
    };
    if (casesIncomplete) {
      setFieldErrors({ caseSelections: '请选择已有案例或明确创建新案例' });
      setErrorRevision((revision) => revision + 1);
      return;
    }
    const parsed = relationFormInputSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        if (field in errors) continue;
        if (field === 'causeEventId') errors[field] = '请选择原因事件';
        else if (field === 'effectEventId') errors[field] = '请选择结果事件';
        else if (field === 'confidence') errors[field] = '请输入 0 到 100 的整数';
        else errors[field] = issue.message;
      }
      setFieldErrors(errors);
      setErrorRevision((revision) => revision + 1);
      return;
    }
    if (pair.data?.sameDirection) return;

    setIsSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.details.fields ?? {});
        setFormError(error.details.message);
      } else {
        setFormError('保存失败，请稍后重试');
      }
      setErrorRevision((revision) => revision + 1);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="event-form relation-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError ? (
        <div className="form-alert" role="alert">
          {formError}
        </div>
      ) : null}
      <div className="form-layout relation-form-layout">
        <div className="form-fields">
          <div className="relation-event-pair">
            <EventSelector
              id="relation-cause-event"
              label="原因事件"
              value={causeEvent}
              error={fieldErrors.causeEventId}
              onChange={setCauseEvent}
              autoFocus={mode === 'create'}
            />
            <div className="relation-event-pair__arrow" aria-hidden="true">
              →
            </div>
            <EventSelector
              id="relation-effect-event"
              label="结果事件"
              value={effectEvent}
              error={fieldErrors.effectEventId}
              onChange={setEffectEvent}
            />
          </div>

          {causeEvent && effectEvent && causeEvent.id === effectEvent.id ? (
            <div className="form-alert">原因事件和结果事件不能相同</div>
          ) : null}
          {pair.data?.sameDirection ? (
            <div className="relation-pair-notice relation-pair-notice--error" role="alert">
              <span>该方向的因果关系已存在</span>
              <Link to={`/relations/${pair.data.sameDirection.id}`}>查看已有关系</Link>
            </div>
          ) : null}
          {pair.data?.reverseDirection ? (
            <div className="relation-pair-notice" role="status">
              <span>反向关系已存在</span>
              <Link to={`/relations/${pair.data.reverseDirection.id}`}>查看反向关系</Link>
            </div>
          ) : null}

          <div className="form-field confidence-field">
            <label htmlFor="relation-confidence">
              置信度 <span aria-hidden="true">*</span>
            </label>
            <div className="confidence-control">
              <input
                id="relation-confidence"
                type="range"
                min="0"
                max="100"
                step="1"
                value={confidence ?? 0}
                aria-label="置信度滑块"
                disabled={confidence === null}
                onChange={(event) => setConfidence(Number(event.target.value))}
              />
              <div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={confidence ?? ''}
                  aria-label="置信度数值"
                  aria-invalid={Boolean(fieldErrors.confidence)}
                  onChange={(event) =>
                    setConfidence(event.target.value === '' ? null : Number(event.target.value))
                  }
                />
                <span>%</span>
              </div>
            </div>
            <span className="field-help">由人工判断并填写 0–100 的整数。</span>
            {fieldErrors.confidence ? (
              <span className="field-error" role="alert">
                {fieldErrors.confidence}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="relation-description">关系说明</label>
            <textarea
              id="relation-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="简要说明两个事件之间的因果关联"
              rows={5}
            />
            {fieldErrors.description ? (
              <span className="field-error" role="alert">
                {fieldErrors.description}
              </span>
            ) : null}
          </div>

          <RelationCasesField
            value={caseSelections}
            onChange={setCaseSelections}
            onIncompleteChange={handleCasesIncomplete}
            error={fieldErrors.caseSelections}
            disabled={isSubmitting}
          />
        </div>

        <aside className="candidate-panel relation-form-aside">
          <h2>事件不在列表中？</h2>
          <p>因果关系只能连接已经存在的原子事件。</p>
          <Link to="/events">前往事件管理</Link>
        </aside>
      </div>

      <div className="form-actions">
        <Link className="button button--secondary" to={cancelTo}>
          取消
        </Link>
        <button
          className="button button--primary"
          type="submit"
          disabled={isSubmitting || Boolean(pair.data?.sameDirection)}
        >
          {isSubmitting ? '保存中…' : mode === 'create' ? '创建关系' : '保存修改'}
        </button>
      </div>
    </form>
  );
}
