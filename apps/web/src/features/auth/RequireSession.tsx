import { Navigate, Outlet, useLocation } from 'react-router';

import { PageSkeleton } from '../../shared/loading/PageSkeleton';
import { useDelayedVisibility } from '../../shared/loading/useDelayedVisibility';
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
  const showAuthSkeleton = useDelayedVisibility(auth.status === 'loading', {
    delayMs: 180,
    minimumVisibleMs: 300,
  });

  if (auth.status === 'loading' || showAuthSkeleton) {
    return (
      <div className="auth-route-state">
        <PageSkeleton variant="settings" visible={showAuthSkeleton} />
      </div>
    );
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ returnTo }} />;
  }
  if (auth.user?.mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/change-initial-password" replace state={{ returnTo }} />;
  }
  return <Outlet />;
}
