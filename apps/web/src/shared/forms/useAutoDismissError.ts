import { useEffect, useRef } from 'react';

export function useAutoDismissError(
  active: boolean,
  revision: number,
  onDismiss: () => void,
  delay = 3_000,
): void {
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active || revision === 0) return;
    const timeout = window.setTimeout(() => dismissRef.current(), delay);
    return () => window.clearTimeout(timeout);
  }, [active, delay, revision]);
}
