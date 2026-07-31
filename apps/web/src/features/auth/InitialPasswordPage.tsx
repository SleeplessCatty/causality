import { changePasswordInputSchema } from '@causality/contracts';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiClientError } from '../../shared/api/httpClient';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { useAuth } from './AuthProvider';

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
    const parsed = changePasswordInputSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError('密码长度必须为 12 至 128 个字符');
      setErrorRevision((value) => value + 1);
      return;
    }
    setSubmitting(true);
    try {
      await auth.changePassword(parsed.data);
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

  async function exit() {
    await auth.logout();
    navigate('/login', { replace: true });
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
          <label htmlFor="auth-current-password">{isInitial ? '初始密码' : '当前密码'}</label>
          <input
            id="auth-current-password"
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            autoFocus
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="auth-new-password">新密码</label>
          <input
            id="auth-new-password"
            type="password"
            value={newPassword}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor="auth-confirm-password">确认新密码</label>
          <input
            id="auth-confirm-password"
            type="password"
            value={confirmation}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <div className="auth-form__actions">
            <button className="button button--secondary" type="button" onClick={() => void exit()}>
              退出登录
            </button>
            <button className="button button--primary" type="submit" disabled={submitting}>
              {submitting ? '保存中…' : '保存新密码'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
