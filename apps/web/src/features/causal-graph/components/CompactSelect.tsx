import { AppSelect, type AppSelectOption } from '../../../shared/controls/AppSelect';

interface CompactSelectProps<T extends string | number> {
  label: string;
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<AppSelectOption<T>>;
  onChange: (value: T) => void;
}

export function CompactSelect<T extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: CompactSelectProps<T>) {
  return (
    <AppSelect
      className="graph-toolbar-field graph-compact-select"
      label={label}
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}
