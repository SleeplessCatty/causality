import { useState, type KeyboardEvent } from 'react';

import { OverflowText } from '../../../shared/tooltip/OverflowText';

interface TagInputProps {
  id: string;
  label: '别名' | '关键词';
  values: string[];
  maxItems: number;
  maxLength: number;
  helper: string;
  onChange: (values: string[]) => void;
}

export function TagInput({
  id,
  label,
  values,
  maxItems,
  maxLength,
  helper,
  onChange,
}: TagInputProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();

  function addCurrentValue(): void {
    const value = input.trim();
    if (!value) return;
    if (value.length > maxLength) {
      setError(`${label}不能超过 ${maxLength} 个字符`);
      return;
    }
    if (values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError(`同一事件不能有重复${label}`);
      return;
    }
    if (values.length >= maxItems) {
      setError(`${label}最多添加 ${maxItems} 个`);
      return;
    }
    onChange([...values, value]);
    setInput('');
    setError(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      addCurrentValue();
    }
  }

  function remove(value: string): void {
    onChange(values.filter((item) => item !== value));
    setError(undefined);
  }

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className={`tag-input${error ? ' tag-input--error' : ''}`}>
        {values.map((value) => (
          <span className="tag-input__tag" key={value}>
            <OverflowText content={value}>
              <span className="tag-input__value">{value}</span>
            </OverflowText>
            <button
              type="button"
              onClick={() => remove(value)}
              aria-label={`移除${label} ${value}`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={`添加${label}`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addCurrentValue}
          placeholder={values.length === 0 ? helper : ''}
        />
      </div>
      <span className="field-help">{helper}</span>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
