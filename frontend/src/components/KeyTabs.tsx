interface KeyTabsProps {
  keys: number[];
  active: number | null;
  dirty: Set<number>;
  onChange: (keys: number) => void;
}

export function KeyTabs({ keys, active, dirty, onChange }: KeyTabsProps) {
  if (keys.length === 0) {
    return null;
  }
  return (
    <div className="key-tabs" role="tablist">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          className={active === key ? 'active' : ''}
          onClick={() => onChange(key)}
        >
          {key}K
          {dirty.has(key) && <span className="dirty-dot" />}
        </button>
      ))}
    </div>
  );
}
