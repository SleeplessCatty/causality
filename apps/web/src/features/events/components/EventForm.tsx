import { eventFormInputSchema, type EventFormInput } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { useAutoDismissError } from '../../../shared/forms/useAutoDismissError';
import type { ListReturnState } from '../../../shared/navigation/listReturn';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getEventCandidates } from '../api/eventApi';
import { ApiClientError } from '../../../shared/api/httpClient';
import { TagInput } from './TagInput';

interface EventFormProps {
  mode: 'create' | 'edit';
  initialValue: EventFormInput;
  excludeId?: string;
  onSubmit: (value: EventFormInput) => Promise<unknown>;
  cancelTo: string;
  cancelState?: ListReturnState;
}

export function EventForm({
  mode,
  initialValue,
  excludeId,
  onSubmit,
  cancelTo,
  cancelState,
}: EventFormProps) {
  const [name, setName] = useState(initialValue.name);
  const [description, setDescription] = useState(initialValue.description ?? '');
  const [aliases, setAliases] = useState(initialValue.aliases);
  const [keywords, setKeywords] = useState(initialValue.keywords);
  const [candidateQuery, setCandidateQuery] = useState(initialValue.name.trim());
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

  useEffect(() => {
    const timeout = window.setTimeout(() => setCandidateQuery(name.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [name]);

  const candidates = useQuery({
    queryKey: ['events', 'candidates', candidateQuery, excludeId ?? null],
    queryFn: ({ signal }) =>
      getEventCandidates(candidateQuery, { limit: 5, ...(excludeId ? { excludeId } : {}) }, signal),
    enabled: candidateQuery.length > 0,
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldErrors({});
    setFormError(undefined);
    const parsed = eventFormInputSchema.safeParse({ name, description, aliases, keywords });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        if (!(field in errors)) {
          errors[field] = field === 'name' ? '请输入标准名称' : issue.message;
        }
      }
      setFieldErrors(errors);
      setErrorRevision((revision) => revision + 1);
      return;
    }

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
    <form className="event-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError ? (
        <div className="form-alert" role="alert">
          {formError}
        </div>
      ) : null}
      <div className="form-layout">
        <div className="form-fields">
          <div className="form-field">
            <label htmlFor="event-name">
              标准名称 <span aria-hidden="true">*</span>
            </label>
            <OverflowText content={name} disableWhenFocused>
              <input
                id="event-name"
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby="event-name-help event-name-error"
                value={name}
                maxLength={50}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：原油价格上涨"
                autoFocus={mode === 'create'}
              />
            </OverflowText>
            <span id="event-name-help" className="field-help">
              使用“主体 +
              单一状态变化”命名，例如“原油价格上涨”。不要在名称中同时描述原因和结果，最多 50 字。
            </span>
            {fieldErrors.name ? (
              <span id="event-name-error" className="field-error" role="alert">
                {fieldErrors.name}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="event-description">事件说明</label>
            <textarea
              id="event-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="说明事件的定义和适用范围"
              rows={5}
            />
            {fieldErrors.description ? (
              <span className="field-error" role="alert">
                {fieldErrors.description}
              </span>
            ) : null}
          </div>

          <TagInput
            id="event-aliases"
            label="别名"
            values={aliases}
            maxItems={20}
            maxLength={80}
            helper="可添加多个别名，按 Enter 或逗号确认"
            onChange={setAliases}
          />
          <TagInput
            id="event-keywords"
            label="关键词"
            values={keywords}
            maxItems={20}
            maxLength={50}
            helper="用于传统搜索，可添加多个关键词"
            onChange={setKeywords}
          />
        </div>

        <aside className="candidate-panel" aria-live="polite">
          {candidates.data && candidates.data.length > 0 ? (
            <>
              <h2>可能已存在</h2>
              <ul>
                {candidates.data.map((candidate) => (
                  <li key={candidate.id}>
                    <OverflowText content={candidate.name}>
                      <Link to={`/events/${candidate.id}`}>{candidate.name}</Link>
                    </OverflowText>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>

      <div className="form-actions">
        <Link className="button button--secondary" to={cancelTo} state={cancelState}>
          取消
        </Link>
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '保存中…' : mode === 'create' ? '创建事件' : '保存修改'}
        </button>
      </div>
    </form>
  );
}
