interface AppBrandMarkProps {
  className?: string;
}

export function AppBrandMark({ className }: AppBrandMarkProps) {
  return (
    <span
      className={['app-brand-mark', className].filter(Boolean).join(' ')}
      data-brand-mark="causality"
      aria-hidden="true"
    >
      C
    </span>
  );
}
