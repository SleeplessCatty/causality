import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  validateGraphFilterDraft,
  type GraphFilterDraft,
  type GraphFilterValues,
} from '../graph/graphQueryState';

interface GraphFilterPopoverProps {
  open: boolean;
  values: GraphFilterValues;
  onApply: (values: GraphFilterValues) => void;
  onReset: () => void;
  onClose: () => void;
}

export function GraphFilterPopover({
  open,
  values,
  onApply,
  onReset,
  onClose,
}: GraphFilterPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const confidenceRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<GraphFilterDraft>(() => ({
    minConfidence: String(values.minConfidence),
    minCaseCount: String(values.minCaseCount),
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof GraphFilterDraft, string>>>({});

  useEffect(() => {
    if (!open) return;
    setDraft({
      minConfidence: String(values.minConfidence),
      minCaseCount: String(values.minCaseCount),
    });
    setErrors({});
    confidenceRef.current?.focus();
  }, [open, values.minCaseCount, values.minConfidence]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || containerRef.current?.contains(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[aria-controls="graph-filter-popover"]')
      ) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const updateDraft = (field: keyof GraphFilterDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateGraphFilterDraft(draft);
    if (!result.success) {
      setErrors(result.errors);
      return;
    }
    onApply(result.values);
  };

  const keepOpen = (event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation();

  return (
    <div
      ref={containerRef}
      id="graph-filter-popover"
      className="graph-filter-popover"
      role="region"
      aria-label="筛选因果关系"
      onPointerDown={keepOpen}
    >
      <form onSubmit={submit} noValidate>
        <strong>筛选因果关系</strong>
        <label>
          <span>最低置信度</span>
          <span className="graph-filter-popover__input">
            <input
              ref={confidenceRef}
              type="text"
              inputMode="numeric"
              aria-label="最低置信度"
              aria-invalid={Boolean(errors.minConfidence)}
              value={draft.minConfidence}
              onChange={(event) => updateDraft('minConfidence', event.target.value)}
            />
            <i>%</i>
          </span>
          {errors.minConfidence ? <small role="alert">{errors.minConfidence}</small> : null}
        </label>
        <label>
          <span>最少案例数</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="最少案例数"
            aria-invalid={Boolean(errors.minCaseCount)}
            value={draft.minCaseCount}
            onChange={(event) => updateDraft('minCaseCount', event.target.value)}
          />
          {errors.minCaseCount ? <small role="alert">{errors.minCaseCount}</small> : null}
        </label>
        <div className="graph-filter-popover__actions">
          <button type="button" onClick={onReset}>
            重置筛选
          </button>
          <button type="submit" className="is-primary">
            应用筛选
          </button>
        </div>
      </form>
    </div>
  );
}
