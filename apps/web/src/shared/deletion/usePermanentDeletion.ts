import type { ApiErrorCode } from '@causality/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/httpClient';
import { useAutoDismissError } from '../forms/useAutoDismissError';

interface PermanentDeletionOptions<TImpact> {
  getImpact(id: string): Promise<TImpact>;
  deleteRecord(id: string): Promise<void>;
  notFoundCode: ApiErrorCode;
  afterDelete(id: string): void | Promise<void>;
  recoverImpact?(error: ApiClientError): TImpact | null;
}

export function usePermanentDeletion<TImpact>({
  getImpact,
  deleteRecord,
  notFoundCode,
  afterDelete,
  recoverImpact,
}: PermanentDeletionOptions<TImpact>) {
  const optionsRef = useRef({
    getImpact,
    deleteRecord,
    notFoundCode,
    afterDelete,
    recoverImpact,
  });
  const impactRequestRevision = useRef(0);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [impact, setImpact] = useState<TImpact | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [dialogErrorRevision, setDialogErrorRevision] = useState(0);
  const [pageErrorRevision, setPageErrorRevision] = useState(0);

  useEffect(() => {
    optionsRef.current = {
      getImpact,
      deleteRecord,
      notFoundCode,
      afterDelete,
      recoverImpact,
    };
  });

  useAutoDismissError(Boolean(dialogError), dialogErrorRevision, () => setDialogError(null));
  useAutoDismissError(Boolean(pageError), pageErrorRevision, () => setPageError(null));

  const close = useCallback(() => {
    if (pending) return;
    setTargetId(null);
    setImpact(null);
    setDialogError(null);
  }, [pending]);

  const requestDelete = useCallback(async (id: string) => {
    const requestRevision = impactRequestRevision.current + 1;
    impactRequestRevision.current = requestRevision;
    setLoadingId(id);
    setPageError(null);
    try {
      const nextImpact = await optionsRef.current.getImpact(id);
      if (impactRequestRevision.current !== requestRevision) return;
      setTargetId(id);
      setImpact(nextImpact);
      setDialogError(null);
    } catch (error) {
      if (impactRequestRevision.current !== requestRevision) return;
      setPageError(
        error instanceof ApiClientError ? error.details.message : '无法检查删除影响，请重试',
      );
      setPageErrorRevision((revision) => revision + 1);
    } finally {
      if (impactRequestRevision.current === requestRevision) setLoadingId(null);
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!targetId || pending) return;
    setPending(true);
    setDialogError(null);
    try {
      await optionsRef.current.deleteRecord(targetId);
      const deletedId = targetId;
      setTargetId(null);
      setImpact(null);
      await optionsRef.current.afterDelete(deletedId);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.details.code === optionsRef.current.notFoundCode) {
          const deletedId = targetId;
          setTargetId(null);
          setImpact(null);
          await optionsRef.current.afterDelete(deletedId);
          return;
        }
        const recovered = optionsRef.current.recoverImpact?.(error);
        if (recovered) {
          setImpact(recovered);
          return;
        }
        setDialogError(error.details.message);
      } else {
        setDialogError('删除失败，请重试');
      }
      setDialogErrorRevision((revision) => revision + 1);
    } finally {
      setPending(false);
    }
  }, [pending, targetId]);

  return {
    targetId,
    impact,
    loadingId,
    pending,
    dialogError,
    pageError,
    close,
    requestDelete,
    confirmDelete,
  };
}
