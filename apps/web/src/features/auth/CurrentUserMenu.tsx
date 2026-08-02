import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from './AuthProvider';

export interface CurrentUserMenuProps {
  collapsed: boolean;
}

export function CurrentUserMenu({ collapsed }: CurrentUserMenuProps) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const username = auth.user?.username;

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  if (auth.status !== 'authenticated' || !username) return null;

  if (collapsed) {
    return (
      <div
        className="current-user-menu current-user-menu--identity"
        aria-label={`当前用户 ${username}`}
        title={username}
      >
        <span className="current-user-menu__avatar" aria-hidden="true">
          {Array.from(username)[0]?.toLocaleUpperCase() ?? 'U'}
        </span>
      </div>
    );
  }

  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  function changePassword() {
    setOpen(false);
    navigate('/change-initial-password', { state: { returnTo: currentPath } });
  }

  async function exit(all: boolean) {
    setOpen(false);
    if (all) await auth.logoutAll();
    else await auth.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="current-user-menu">
      {open ? (
        <div className="current-user-menu__popover" role="menu" aria-label="当前用户操作">
          <button type="button" role="menuitem" onClick={changePassword}>
            修改密码
          </button>
          <button type="button" role="menuitem" onClick={() => void exit(false)}>
            退出当前会话
          </button>
          <button type="button" role="menuitem" onClick={() => void exit(true)}>
            退出全部会话
          </button>
        </div>
      ) : null}
      <button
        className="current-user-menu__trigger"
        type="button"
        aria-label="打开当前用户菜单"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="current-user-menu__avatar" aria-hidden="true">
          {Array.from(username)[0]?.toLocaleUpperCase() ?? 'U'}
        </span>
        <span className="current-user-menu__name">{username}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
    </div>
  );
}
