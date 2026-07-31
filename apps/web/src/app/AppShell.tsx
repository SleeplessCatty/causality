import { Outlet, useLocation } from 'react-router';

import { CurrentUserMenu } from '../features/auth/CurrentUserMenu';
import { AppSidebar } from './AppSidebar';
import { useAppSidebar } from './useAppSidebar';

export function AppShell() {
  const location = useLocation();
  const isGraphRoute = location.pathname === '/graph';
  const sidebar = useAppSidebar(isGraphRoute);

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
