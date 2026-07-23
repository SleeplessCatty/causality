import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { getListFocusId } from './listReturn';

export function listRecordDomId(recordId: string): string {
  return `list-record-${recordId}`;
}

export function useListRecordFocus(recordIds: readonly string[]): void {
  const location = useLocation();
  const focusId = getListFocusId(location.state);
  const handledLocationKey = useRef<string | null>(null);

  useEffect(() => {
    if (!focusId || handledLocationKey.current === location.key || !recordIds.includes(focusId)) {
      return;
    }
    const row = document.getElementById(listRecordDomId(focusId));
    if (!row) return;
    handledLocationKey.current = location.key;
    row.scrollIntoView?.({ block: 'center' });
  }, [focusId, location.key, recordIds]);
}
