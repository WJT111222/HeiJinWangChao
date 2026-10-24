import { useState } from 'react';
const presets = [4096, 8192, 16384];
export function OutputTokenLimit({ value, onChange }: { value?: number; onChange: (value: number) => void }) {
  const [custom, setCustom] = useState(value === undefined || !presets.includes(value));
  return <div>
    <label>最大输出 Token 档位
      <select aria-label="最大输出 Token 档位" value={custom ? 'custom' : String(value)} onChange={(event) => {
        const selected = event.currentTarget.value;
        setCustom(selected === 'custom');
        if (selected !== 'custom') onChange(Number(selected));
      }}>
        <option value="4096">4K · 4096</option>
        <option value="8192">8K · 8192</option>
        <option value="16384">16K · 16384</option>
        <option value="custom">自定义</option>
      </select>
    </label>
    {custom && <label>自定义最大输出 Token
      <input aria-label="自定义最大输出 Token" type="number" min="1" max="1000000" step="1" required
        value={value === undefined || Number.isNaN(value) ? '' : value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </label>}
  </div>;
}
