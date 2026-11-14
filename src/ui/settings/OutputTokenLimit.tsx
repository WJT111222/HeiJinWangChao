import { useDesktopFeedback } from '../Feedback';
import { useState } from 'react';
const presets = [4096, 8192, 16384];
// 档位直接显示为按钮：4K / 8K（推荐）/ 16K / 自定义。只保存玩家明确选择的值。
export function OutputTokenLimit({ value, onChange }: { value?: number; onChange: (value: number) => void }) {
  const desktop = useDesktopFeedback();
  const [custom, setCustom] = useState(value === undefined || !presets.includes(value));
  return <div className="output-token-limit">
    <div className="ai-chips" role="group" aria-label="最大输出 Token 档位">
      {presets.map((preset) => <button type="button" key={preset} className="ai-chip" aria-pressed={!custom && value === preset}
        onClick={() => { setCustom(false); onChange(preset); }}>{preset / 1024}K{preset === 8192 ? '（推荐）' : ''}</button>)}
      <button type="button" className="ai-chip" aria-pressed={custom} onClick={() => setCustom(true)}>自定义</button>
      {custom && <label className="ai-custom-tokens">
        <input aria-label="自定义最大输出 Token" type="number" inputMode="numeric" min="1" max="1000000" step="1" required
          value={value === undefined || Number.isNaN(value) ? '' : value}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
        {desktop ? ' Token' : <em className="token-unit">Token</em>}
      </label>}
    </div>
  </div>;
}
