import { useState, type InputHTMLAttributes } from 'react';

type PasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'autoComplete' | 'id' | 'onChange' | 'type' | 'value'
> & {
  id: string;
  label: string;
  value: string;
  onChange: InputHTMLAttributes<HTMLInputElement>['onChange'];
  autoComplete: string;
};

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  ...inputProps
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const visibilityAction = `${isVisible ? '隐藏' : '显示'}${label}`;

  return (
    <div className="auth-password-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password-field__control">
        <input
          {...inputProps}
          id={id}
          type={isVisible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={onChange}
        />
        <button
          className="auth-password-field__toggle"
          type="button"
          aria-label={visibilityAction}
          onClick={() => setIsVisible((visible) => !visible)}
        >
          {isVisible ? '隐藏' : '显示'}
        </button>
      </div>
    </div>
  );
}
