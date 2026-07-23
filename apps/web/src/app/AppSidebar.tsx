import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface AppSidebarProps {
  collapsed: boolean;
  forced: boolean;
  onToggle: () => void;
}

interface NavigationItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const iconProps = {
  'aria-hidden': true,
  fill: 'none',
  viewBox: '0 0 24 24',
} as const;

const navigationItems: NavigationItem[] = [
  {
    to: '/events',
    label: '原子事件',
    icon: (
      <svg {...iconProps}>
        <path d="M7.5 3.75h9a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z" />
        <path d="M8.75 8h6.5M8.75 12h6.5M8.75 16h4" />
      </svg>
    ),
  },
  {
    to: '/relations',
    label: '因果关系',
    icon: (
      <svg {...iconProps}>
        <circle cx="6" cy="12" r="2.25" />
        <circle cx="18" cy="6" r="2.25" />
        <circle cx="18" cy="18" r="2.25" />
        <path d="m8.1 11 7.8-4M8.1 13l7.8 4" />
      </svg>
    ),
  },
  {
    to: '/cases',
    label: '具体案例',
    icon: (
      <svg {...iconProps}>
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5v-11Z" />
        <path d="M8.5 3v3M15.5 3v3M8.5 10h7M8.5 14h5" />
      </svg>
    ),
  },
  {
    to: '/graph',
    label: '因果图',
    icon: (
      <svg {...iconProps}>
        <circle cx="5.5" cy="12" r="2" />
        <circle cx="18.5" cy="6" r="2" />
        <circle cx="18.5" cy="18" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="m7.5 12 2.5 0m3.5-1.25 3.25-3M13.5 13.25l3.25 3" />
      </svg>
    ),
  },
  {
    to: '/maintenance',
    label: '数据维护',
    icon: (
      <svg {...iconProps}>
        <path d="M5 5.5h14v13H5z" />
        <path d="M8 9h8M8 12h5M8 15h7" />
        <path d="M9 3.5h6v3H9z" />
      </svg>
    ),
  },
  {
    to: '/system',
    label: '系统状态',
    icon: (
      <svg {...iconProps}>
        <path d="M4 12h3l2-5 4 10 2-5h5" />
        <path d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
      </svg>
    ),
  },
];

export function AppSidebar({ collapsed, forced, onToggle }: AppSidebarProps) {
  const toggleLabel = forced ? '当前窗口空间不足' : collapsed ? '展开导航栏' : '收起导航栏';

  return (
    <aside className="app-sidebar" aria-label="应用导航">
      <NavLink className="app-sidebar__brand" to="/events" aria-label="Causality 原子事件首页">
        <span className="app-sidebar__brand-mark" aria-hidden="true">
          C
        </span>
        <span className="app-sidebar__brand-name">Causality</span>
      </NavLink>

      <nav className="app-sidebar__navigation" aria-label="主导航">
        {navigationItems.map((item) => (
          <NavLink
            key={item.to}
            className={({ isActive }) => `app-sidebar__link${isActive ? ' is-active' : ''}`}
            to={item.to}
            aria-label={item.label}
            data-tooltip={collapsed ? item.label : undefined}
            title={collapsed ? item.label : undefined}
          >
            <span className="app-sidebar__icon">{item.icon}</span>
            <span className="app-sidebar__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button
        className="app-sidebar__toggle"
        type="button"
        onClick={onToggle}
        disabled={forced}
        aria-label={toggleLabel}
        title={forced ? toggleLabel : undefined}
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d={collapsed ? 'm9 7 5 5-5 5' : 'm15 7-5 5 5 5'} />
          <path d="M4.5 4.5h15v15h-15z" />
        </svg>
        <span className="app-sidebar__toggle-label">
          {forced ? '空间不足' : collapsed ? '展开导航' : '收起导航'}
        </span>
      </button>
    </aside>
  );
}
