import { loginInputSchema } from '@causality/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiClientError } from '../../shared/api/httpClient';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { useAuth } from './AuthProvider';

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '登录失败，请稍后重试';
  if (error.details.code === 'ACCOUNT_LOCKED') return '账号已临时锁定，请稍后再试';
  if (error.details.code === 'TOO_MANY_ATTEMPTS') return '登录尝试过于频繁，请稍后再试';
  if (error.details.code === 'INVALID_CREDENTIALS') return '用户名或密码错误';
  return error.details.message;
}

function returnPath(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return '/events';
  const value = (state as { returnTo?: unknown }).returnTo;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/events';
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const target = returnPath(location.state);

  useAutoDismissError(Boolean(error), errorRevision, () => setError(undefined));

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (auth.user?.mustChangePassword) {
      navigate('/change-initial-password', { replace: true, state: { returnTo: target } });
      return;
    }
    navigate(target, { replace: true });
  }, [auth.status, auth.user?.mustChangePassword, navigate, target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const parsed = loginInputSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError('请输入有效的用户名和密码');
      setErrorRevision((value) => value + 1);
      return;
    }
    setSubmitting(true);
    try {
      await auth.login(parsed.data);
    } catch (cause) {
      setError(loginErrorMessage(cause));
      setErrorRevision((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__brand" aria-hidden="true">
          C
        </div>
        <header>
          <h1 id="login-title">登录 Causality</h1>
          <p>进入共享因果知识库</p>
        </header>
        {error ? (
          <div className="form-alert" role="alert">
            {error}
          </div>
        ) : null}
        <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="auth-username">用户名</label>
          <input
            id="auth-username"
            name="username"
            value={username}
            minLength={3}
            maxLength={50}
            autoComplete="username"
            autoFocus
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="auth-password">密码</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            value={password}
            minLength={12}
            maxLength={128}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="button button--primary auth-form__submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}
