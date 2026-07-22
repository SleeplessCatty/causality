import { useCallback, useEffect, useRef, useState } from 'react';

export const sidebarStorageKey = 'causality.sidebar.preference';
const constrainedQuery = '(max-width: 1143px)';

export interface AppSidebarState {
  collapsed: boolean;
  forced: boolean;
  toggle: () => void;
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === 'collapsed';
  } catch {
    return false;
  }
}

export function useAppSidebar(isGraphRoute: boolean): AppSidebarState {
  const [ordinaryCollapsed, setOrdinaryCollapsed] = useState(readPreference);
  const [graphCollapsed, setGraphCollapsed] = useState(true);
  const [forced, setForced] = useState(() => window.matchMedia(constrainedQuery).matches);
  const previousGraphRoute = useRef(isGraphRoute);

  useEffect(() => {
    const query = window.matchMedia(constrainedQuery);
    const sync = () => setForced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isGraphRoute && !previousGraphRoute.current) {
      setGraphCollapsed(true);
    }
    previousGraphRoute.current = isGraphRoute;
  }, [isGraphRoute]);

  const toggle = useCallback(() => {
    if (forced) return;

    if (isGraphRoute) {
      setGraphCollapsed((current) => !current);
      return;
    }

    setOrdinaryCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, next ? 'collapsed' : 'expanded');
      } catch {
        // Local storage is an enhancement; navigation remains usable without it.
      }
      return next;
    });
  }, [forced, isGraphRoute]);

  return {
    collapsed: forced || (isGraphRoute ? graphCollapsed : ordinaryCollapsed),
    forced,
    toggle,
  };
}
