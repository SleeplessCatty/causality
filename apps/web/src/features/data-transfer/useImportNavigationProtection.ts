import { useEffect } from 'react';
import { useBlocker } from 'react-router';

export function useImportNavigationProtection(active: boolean) {
  const blocker = useBlocker(
    ({ nextLocation }) => active && !nextLocation.pathname.startsWith('/data-transfer/imports/'),
  );

  useEffect(() => {
    if (!active) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active]);

  return blocker;
}
