import { useEffect, useRef, useState } from 'react';

export interface DelayedVisibilityOptions {
  delayMs: number;
  minimumVisibleMs?: number;
}

export function useDelayedVisibility(
  active: boolean,
  { delayMs, minimumVisibleMs = 0 }: DelayedVisibilityOptions,
): boolean {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let timeout: number | undefined;

    if (active) {
      if (!visible) {
        timeout = window.setTimeout(
          () => {
            visibleSinceRef.current = Date.now();
            setVisible(true);
          },
          Math.max(0, delayMs),
        );
      }
    } else if (visible) {
      const visibleSince = visibleSinceRef.current ?? Date.now();
      const remaining = Math.max(0, minimumVisibleMs - (Date.now() - visibleSince));
      if (remaining === 0) {
        visibleSinceRef.current = undefined;
        setVisible(false);
      } else {
        timeout = window.setTimeout(() => {
          visibleSinceRef.current = undefined;
          setVisible(false);
        }, remaining);
      }
    } else {
      visibleSinceRef.current = undefined;
    }

    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [active, delayMs, minimumVisibleMs, visible]);

  return visible;
}
