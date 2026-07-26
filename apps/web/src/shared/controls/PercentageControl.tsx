import type { CSSProperties } from 'react';

interface PercentageControlProps {
  id: string;
  label: string;
  value: number | null;
  sliderLabel: string;
  numberLabel: string;
  onChange(value: number | null): void;
  onCommit?: (() => void) | undefined;
  required?: boolean;
  help?: string | undefined;
  error?: string | undefined;
  disabled?: boolean;
  preserveAppearanceWhenDisabled?: boolean;
}

export function PercentageControl({
  id,
  label,
  value,
  sliderLabel,
  numberLabel,
  onChange,
  onCommit,
  required = false,
  help,
  error,
  disabled = false,
  preserveAppearanceWhenDisabled = false,
}: PercentageControlProps) {
  return (
    <div className="form-field confidence-field">
      <label htmlFor={id}>
        {label} {required ? <span aria-hidden="true">*</span> : null}
      </label>
      <div className="confidence-control">
        <input
          id={id}
          type="range"
          min="0"
          max="100"
          step="1"
          value={value ?? 0}
          aria-label={sliderLabel}
          disabled={disabled || value === null}
          className={preserveAppearanceWhenDisabled ? 'range-control--stable-disabled' : undefined}
          style={{ '--percentage-value': `${value ?? 0}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={onCommit}
          onKeyUp={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onCommit?.();
          }}
        />
        <div>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={value ?? ''}
            aria-label={numberLabel}
            aria-invalid={Boolean(error)}
            disabled={disabled}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
            onBlur={onCommit}
          />
          <span>%</span>
        </div>
      </div>
      {help ? <span className="field-help">{help}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
