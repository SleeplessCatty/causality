import { caseFormInputSchema, type CaseFormInput } from '@causality/contracts';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { useAutoDismissError } from '../../../shared/forms/useAutoDismissError';
import { ApiClientError } from '../../../shared/api/httpClient';
import type { ListReturnState } from '../../../shared/navigation/listReturn';

interface CaseFormProps {
  mode: 'create' | 'edit';
  initialContent: string;
  onSubmit: (value: CaseFormInput) => Promise<unknown>;
  cancelTo: string;
  cancelState?: ListReturnState;
}

export function CaseForm({ mode, initialContent, onSubmit, cancelTo, cancelState }: CaseFormProps) {
  const [content, setContent] = useState(initialContent);
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [conflictingCaseId, setConflictingCaseId] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedLength = content.trim().length;

  useAutoDismissError(Boolean(fieldError || formError), errorRevision, () => {
    setFieldError(undefined);
    setFormError(undefined);
    setConflictingCaseId(undefined);
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldError(undefined);
    setFormError(undefined);
    setConflictingCaseId(undefined);

    const parsed = caseFormInputSchema.safeParse({ content });
    if (!parsed.success) {
      setFieldError(normalizedLength === 0 ? '请输入案例内容' : '案例内容不能超过 100 字');
      setErrorRevision((revision) => revision + 1);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldError(error.details.fields?.content);
        setFormError(error.details.message);
        if (error.details.code === 'CASE_CONTENT_CONFLICT') {
          setConflictingCaseId(error.details.existingId);
        }
      } else {
        setFormError('保存失败，请稍后重试');
      }
      setErrorRevision((revision) => revision + 1);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="event-form case-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError ? (
        <div className="form-alert" role="alert">
          <span>{formError}</span>
          {conflictingCaseId ? <Link to={`/cases/${conflictingCaseId}`}>查看已有案例</Link> : null}
        </div>
      ) : null}
      <div className="form-fields case-form__fields">
        <div className="form-field">
          <label htmlFor="case-content">
            案例内容 <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="case-content"
            value={content}
            maxLength={100}
            aria-invalid={Boolean(fieldError)}
            aria-describedby="case-content-help case-content-count case-content-error"
            onChange={(event) => setContent(event.target.value)}
            placeholder="例如：2025年4月美国宣布新一轮关税措施"
            rows={4}
            autoFocus={mode === 'create'}
          />
          <div className="case-form__meta">
            <span id="case-content-help" className="field-help">
              简短记录一件确切发生过的真实事件，最多 100 字。
            </span>
            <span
              id="case-content-count"
              className={normalizedLength > 100 ? 'field-error' : 'field-help'}
            >
              {normalizedLength} / 100
            </span>
          </div>
          {fieldError ? (
            <span id="case-content-error" className="field-error" role="alert">
              {fieldError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="form-actions">
        <Link className="button button--secondary" to={cancelTo} state={cancelState}>
          取消
        </Link>
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '保存中…' : mode === 'create' ? '创建案例' : '保存修改'}
        </button>
      </div>
    </form>
  );
}
