import type { FieldSpec } from '../api/client';

export function concreteKeys(spec: FieldSpec, keys: number): string[] {
  if (!spec.perColumn) {
    return [spec.name];
  }
  const out: string[] = [];
  for (let i = 0; i < keys; i++) {
    out.push(`${spec.name}${spec.indexStart + i}${spec.indexSuffix}`);
  }
  return out;
}

function isNumeric(value: string): boolean {
  return value.trim() !== '' && !Number.isNaN(Number(value));
}

export function validateValue(
  spec: FieldSpec,
  keys: number,
  value: string,
): string | null {
  if (value === '') {
    return null;
  }
  switch (spec.type) {
    case 'number':
      return isNumeric(value) ? null : '必须是数字';
    case 'int':
      return /^-?\d+$/.test(value.trim()) ? null : '必须是整数';
    case 'bool':
      return value === '0' || value === '1' ? null : '只能是 0 或 1';
    case 'enum': {
      const matched = spec.enumValues.some(
        (option) => option.toLowerCase() === value.trim().toLowerCase(),
      );
      return matched ? null : `可选：${spec.enumValues.join(' / ')}`;
    }
    case 'rgb':
    case 'rgba': {
      const parts = value.split(',').map((part) => part.trim());
      const countOk =
        parts.length === 3 ||
        (spec.type === 'rgba' && parts.length === 4);
      if (!countOk) {
        return spec.type === 'rgba' ? '应为 RGB 或 RGBA' : '应为 RGB';
      }
      const channelOk = parts.every(
        (part) =>
          /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
      );
      return channelOk ? null : '通道必须是 0-255 的整数';
    }
    case 'list_number':
    case 'list_int': {
      const parts = value.split(',').map((part) => part.trim());
      if (parts.length > keys) {
        return `最多 ${keys} 个值，多余值会被 osu! 忽略`;
      }
      const bad = parts.some((part) =>
        spec.type === 'list_int' ? !/^-?\d+$/.test(part) : !isNumeric(part),
      );
      return bad ? '每个值都必须是数字' : null;
    }
    default:
      return null;
  }
}

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const number = Number.parseInt(value, 16);
  if (Number.isNaN(number)) {
    return '0,0,0';
  }
  return `${(number >> 16) & 255},${(number >> 8) & 255},${number & 255}`;
}

function rgbToHex(value: string): string {
  const parts = value.split(',').map((part) => part.trim());
  const channels = parts.slice(0, 3).map((part) => {
    const number = Math.max(0, Math.min(255, Number(part) || 0));
    return number.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

interface FieldControlProps {
  spec: FieldSpec;
  keys: number;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

export function FieldControl({
  spec,
  keys,
  value,
  onChange,
}: FieldControlProps) {
  if (spec.type === 'bool') {
    return (
      <div className="segmented">
        {['0', '1'].map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'active' : ''}
            onClick={() => onChange(option)}
          >
            {option === '0' ? '关' : '开'}
          </button>
        ))}
      </div>
    );
  }

  if (spec.type === 'enum') {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">默认 / 未设置</option>
        {spec.enumValues.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (spec.type === 'rgb' || spec.type === 'rgba') {
    const parts = value.split(',').map((part) => part.trim());
    const alpha =
      spec.type === 'rgba' && parts.length === 4 ? parts[3] : '';
    return (
      <div className="color-field">
        <input
          type="color"
          value={rgbToHex(parts.join(',') || spec.defaultValue)}
          onChange={(event) => {
            const rgb = hexToRgb(event.target.value);
            onChange(alpha ? `${rgb},${alpha}` : rgb);
          }}
        />
        <input
          type="text"
          value={value}
          placeholder={spec.defaultValue}
          onChange={(event) => onChange(event.target.value)}
        />
        {spec.type === 'rgba' && (
          <input
            type="number"
            min={0}
            max={255}
            value={alpha}
            placeholder="255"
            title="Alpha 透明度"
            onChange={(event) => {
              const rgb = parts.slice(0, 3).join(',');
              onChange(rgb ? `${rgb},${event.target.value}` : '');
            }}
          />
        )}
      </div>
    );
  }

  if (spec.type === 'list_number' || spec.type === 'list_int') {
    const parts = value === '' ? [] : value.split(',');
    const slots: string[] = [];
    for (let i = 0; i < keys; i++) {
      slots.push(parts[i] ?? '');
    }
    return (
      <div className="slot-row">
        {slots.map((slot, index) => (
          <input
            key={index}
            type="text"
            value={slot}
            aria-label={`${spec.label} 第 ${index + 1} 列`}
            onChange={(event) => {
              const next = slots.slice();
              next[index] = event.target.value;
              let joined = next.join(',');
              while (joined.endsWith(',')) {
                joined = joined.slice(0, -1);
              }
              onChange(joined);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value}
      placeholder={spec.defaultValue}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
