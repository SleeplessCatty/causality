import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import { CurrentUserMenu } from '../features/auth/CurrentUserMenu';
import { AppSidebar } from './AppSidebar';
import { preloadCommonRoutes } from './preloadableRoutes';
import { useAppSidebar } from './useAppSidebar';

export function AppShell() {
  const location = useLocation();
  const isGraphRoute = location.pathname === '/graph';
  const sidebar = useAppSidebar(isGraphRoute);

  useEffect(() => {
    const preload = () => void preloadCommonRoutes().catch(() => undefined);
    const idleWindow = window as unknown as Omit<
      Window,
      'requestIdleCallback' | 'cancelIdleCallback'
    > & {
      requestIdleCallback?: Window['requestIdleCallback'];
      cancelIdleCallback?: Window['cancelIdleCallback'];
    };
    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preload);
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(preload, 200);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div
      className={`product-shell${sidebar.collapsed ? ' is-sidebar-collapsed' : ''}${isGraphRoute ? ' is-graph-route' : ''}`}
      data-sidebar-state={sidebar.collapsed ? 'collapsed' : 'expanded'}
    >
      <AppSidebar
        collapsed={sidebar.collapsed}
        forced={sidebar.forced}
        onToggle={sidebar.toggle}
        footer={<CurrentUserMenu collapsed={sidebar.collapsed} />}
      />
      <main className="product-main">
        <Outlet />
      </main>
    </div>
  );
}
