import { changeInitialPasswordInputSchema, changePasswordInputSchema } from '@causality/contracts';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiClientError } from '../../shared/api/httpClient';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { useAuth } from './AuthProvider';
import { PasswordField } from './PasswordField';

function resolveReturnTo(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return '/events';
  const value = (state as { returnTo?: unknown }).returnTo;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/events';
}

export function InitialPasswordPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const isInitial = auth.user?.mustChangePassword ?? false;
  const returnTo = resolveReturnTo(location.state);

  useAutoDismissError(Boolean(error), errorRevision, () => setError(undefined));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致');
      setErrorRevision((value) => value + 1);
      return;
    }
    const initialInput = isInitial
      ? changeInitialPasswordInputSchema.safeParse({ newPassword })
      : null;
    const regularInput = isInitial
      ? null
      : changePasswordInputSchema.safeParse({ currentPassword, newPassword });
    if (initialInput?.success === false || regularInput?.success === false) {
      setError('密码长度必须为 12 至 128 个字符');
      setErrorRevision((value) => value + 1);
      return;
    }
    setSubmitting(true);
    try {
      if (initialInput?.success) await auth.changeInitialPassword(initialInput.data);
      else if (regularInput?.success) await auth.changePassword(regularInput.data);
      navigate(returnTo, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiClientError ? cause.details.message : '修改密码失败，请稍后重试',
      );
      setErrorRevision((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="password-change-title">
        <header>
          <h1 id="password-change-title">{isInitial ? '设置新密码' : '修改密码'}</h1>
          <p>{isInitial ? '首次登录必须先替换服务器生成的初始密码' : '修改当前账号的登录密码'}</p>
        </header>
        {error ? (
          <div className="form-alert" role="alert">
            {error}
          </div>
        ) : null}
        <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
          {!isInitial ? (
            <PasswordField
              id="auth-current-password"
              label="当前密码"
              value={currentPassword}
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              autoFocus
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          ) : null}
          <PasswordField
            id="auth-new-password"
            label="新密码"
            value={newPassword}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            autoFocus={isInitial}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <PasswordField
            id="auth-confirm-password"
            label="确认新密码"
            value={confirmation}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <div className="auth-form__actions">
            {!isInitial ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => navigate(returnTo, { replace: true })}
              >
                取消
              </button>
            ) : null}
            <button className="button button--primary" type="submit" disabled={submitting}>
              {submitting ? '保存中…' : '保存新密码'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
