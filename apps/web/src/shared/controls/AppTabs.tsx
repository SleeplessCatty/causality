import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface AppTab<Value extends string> {
  value: Value;
  label: string;
}

export interface AppTabsProps<Value extends string> {
  id: string;
  label: string;
  value: Value;
  tabs: readonly AppTab<Value>[];
  onChange(value: Value): void;
  children: ReactNode;
}

export function AppTabs<Value extends string>({
  id,
  label,
  value,
  tabs,
  onChange,
  children,
}: AppTabsProps<Value>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const activeTab = tabs[activeIndex];
  const panelId = `${id}-panel`;

  function activate(index: number): void {
    const tab = tabs[index];
    if (!tab) return;
    tabRefs.current[index]?.focus();
    onChange(tab.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    activate(nextIndex);
  }

  return (
    <div className="app-tabs">
      <div className="app-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`${id}-tab-${tab.value}`}
              className={['app-tabs__tab', selected ? 'app-tabs__tab--active' : undefined]
                .filter(Boolean)
                .join(' ')}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id={panelId}
        className="app-tabs__panel"
        role="tabpanel"
        aria-labelledby={activeTab ? `${id}-tab-${activeTab.value}` : undefined}
      >
        {children}
      </div>
    </div>
  );
}
