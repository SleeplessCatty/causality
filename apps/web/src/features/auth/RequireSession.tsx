import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './AuthProvider';

export interface RequireSessionProps {
  allowPasswordChange?: boolean;
}

function currentPath(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

export function RequireSession({ allowPasswordChange = false }: RequireSessionProps) {
  const auth = useAuth();
  const location = useLocation();
  const returnTo = currentPath(location.pathname, location.search, location.hash);

  if (auth.status === 'loading') {
    return <div className="auth-route-state">正在检查登录状态…</div>;
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ returnTo }} />;
  }
  if (auth.user?.mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/change-initial-password" replace state={{ returnTo }} />;
  }
  return <Outlet />;
}
