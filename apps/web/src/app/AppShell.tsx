import { NavLink, Outlet } from 'react-router';

export function AppShell() {
  return (
    <div className="product-shell">
      <header className="product-header">
        <div className="product-header__inner">
          <NavLink className="product-brand" to="/events" aria-label="Causality 事件首页">
            <span className="product-brand__mark" aria-hidden="true">
              C
            </span>
            <span>Causality</span>
          </NavLink>
          <nav className="primary-navigation" aria-label="主导航">
            <NavLink to="/events">事件</NavLink>
            <NavLink to="/relations">因果关系</NavLink>
            <NavLink to="/cases">具体案例</NavLink>
            <NavLink to="/system">系统状态</NavLink>
          </nav>
        </div>
      </header>
      <main className="product-main">
        <Outlet />
      </main>
    </div>
  );
}
