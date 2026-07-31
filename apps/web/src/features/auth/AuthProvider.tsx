import type { AuthenticatedUser, ChangePasswordInput, LoginInput } from '@causality/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { ApiClientError, setCsrfTokenProvider } from '../../shared/api/httpClient';
import * as authApi from './authApi';

export interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthenticatedUser | null;
  csrfToken: string | null;
  login(input: LoginInput): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const csrfTokenRef = useRef<string | null>(null);

  const setAuthenticated = useCallback((nextUser: AuthenticatedUser, nextCsrfToken: string) => {
    csrfTokenRef.current = nextCsrfToken;
    setCsrfToken(nextCsrfToken);
    setUser(nextUser);
    setStatus('authenticated');
  }, []);

  const setAnonymous = useCallback(() => {
    csrfTokenRef.current = null;
    setCsrfToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setCsrfTokenProvider(() => csrfTokenRef.current);
    return () => setCsrfTokenProvider(() => null);
  }, []);

  useEffect(() => {
    let active = true;
    void authApi
      .getAuthSession()
      .then((session) => {
        if (active) setAuthenticated(session.user, session.csrfToken);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiClientError && error.details.code === 'AUTH_REQUIRED') {
          setAnonymous();
          return;
        }
        setAnonymous();
      });
    return () => {
      active = false;
    };
  }, [setAnonymous, setAuthenticated]);

  useEffect(() => {
    const unauthorized = () => setAnonymous();
    window.addEventListener('causality:unauthorized', unauthorized);
    return () => window.removeEventListener('causality:unauthorized', unauthorized);
  }, [setAnonymous]);

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await authApi.login(input);
      setAuthenticated(session.user, session.csrfToken);
    },
    [setAuthenticated],
  );

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    await authApi.changePassword(input);
    setUser((current) => (current ? { ...current, mustChangePassword: false } : current));
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAnonymous();
    }
  }, [setAnonymous]);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } finally {
      setAnonymous();
    }
  }, [setAnonymous]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, csrfToken, login, changePassword, logout, logoutAll }),
    [changePassword, csrfToken, login, logout, logoutAll, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
