import { useState } from 'react';
import { ThemedSelect } from '../components/ThemedSelect';
const presets = [4096, 8192, 16384];
export function OutputTokenLimit({ value, onChange }: { value?: number; onChange: (value: number) => void }) {
  const [custom, setCustom] = useState(value === undefined || !presets.includes(value));
  return <div>
    <ThemedSelect label="最大输出 Token 档位" value={custom ? 'custom' : String(value)}
      options={[{ value: '4096', label: '4K · 4096' }, { value: '8192', label: '8K · 8192' },
        { value: '16384', label: '16K · 16384' }, { value: 'custom', label: '自定义' }]}
      onChange={(selected) => { setCustom(selected === 'custom'); if (selected !== 'custom') onChange(Number(selected)); }} />
    {custom && <label>自定义最大输出 Token
      <input aria-label="自定义最大输出 Token" type="number" min="1" max="1000000" step="1" required
        value={value === undefined || Number.isNaN(value) ? '' : value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </label>}
  </div>;
}
