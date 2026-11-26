import { useState, type CSSProperties } from 'react';
import { z } from 'zod';
import mascot from '../../presets/resources/peinture-1124-mascot.png';

const palette = z.object({ bg: z.string().regex(/^#[\da-f]{6}$/iu), button: z.string().regex(/^#[\da-f]{6}$/iu) });
const look = z.object({
  day: palette.default({ bg: '#faf6e9', button: '#225b68' }),
  night: palette.default({ bg: '#192c35', button: '#a6d6cc' }),
  skin: z.enum(['harbor', 'classic']).default('harbor'),
  backdrop: z.string().regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/u).optional(),
});
type Look = z.infer<typeof look>;
const key = 'heijin.peinture-1124.appearance';
function ink(hex: string) {
  const [r,g,b] = hex.slice(1).match(/../gu)!.map(channel => {
    const n = parseInt(channel, 16) / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b > .179 ? '#101316' : '#ffffff';
}

export function useTideAppearance(active: boolean, theme: 'day' | 'night') {
  const [value, setValue] = useState<Look>(() => {
    try { if (active) return look.parse(JSON.parse(localStorage.getItem(key) ?? '{}')); }
    catch { /* The authored palette is available even when browser storage is unavailable. */ }
    return look.parse({});
  });
  const [notice, setNotice] = useState('');
  const colors = value[theme], text = ink(colors.bg);
  function update(next: Look) {
    try { localStorage.setItem(key, JSON.stringify(next)); setValue(next); setNotice(''); }
    catch { setNotice('浏览器未能保存外观，请检查可用空间。'); }
  }
  const mix = (amount: number) => `color-mix(in srgb, ${colors.bg}, ${text} ${amount}%)`;
  const style = active ? {
    '--sheet': colors.bg, '--field': mix(4), '--card': mix(6), '--selected': mix(12),
    '--line': mix(36), '--hair': mix(22), '--head': text, '--muted': mix(76),
    '--gold': `color-mix(in srgb, ${text}, ${colors.button} 35%)`,
    '--key-bg': colors.button, '--key-text': ink(colors.button),
    ...(value.backdrop && { backgroundImage: `linear-gradient(${colors.bg}db,${colors.bg}db), url("${value.backdrop}")`,
      backgroundPosition:'center', backgroundSize:'cover' }),
  } as CSSProperties : undefined;
  return { value, style, notice, update, setNotice };
}

export function TideMark({ skin }: { skin: Look['skin'] }) {
  return skin === 'harbor' ? <img className="tide-mark" src={mascot} alt="" width={60} height={60}/> :
    <svg className="tide-mark" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 14c3.5-4.5 7-4.5 10.5 0s7 4.5 10.5 0M5 21c3.5-4.5 7-4.5 10.5 0s7 4.5 10.5 0"/><circle cx="25" cy="8" r="1.6"/>
    </svg>;
}

export function TideAppearance({ appearance, theme }: { appearance: ReturnType<typeof useTideAppearance>; theme: 'day' | 'night' }) {
  const { value, update, notice, setNotice } = appearance;
  return <section className="peinture-section tide-appearance">
    <header><h3>潮汐外观</h3></header>
    <label>浪潮标识<select value={value.skin} onChange={e => update({ ...value, skin: e.target.value as Look['skin'] })}>
      <option value="harbor">浪潮娘 · 港口</option><option value="classic">经典 · 波浪</option>
    </select></label>
    {(['bg', 'button'] as const).map(field => <label key={field}>{theme === 'day' ? '日潮' : '夜潮'}{field === 'bg' ? '背景色' : '按钮色'}
      <input type="color" value={value[theme][field]} onChange={e => update({ ...value, [theme]: { ...value[theme], [field]: e.target.value } })}/>
    </label>)}
    <label>本地背景图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        try {
          const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error();
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } finally { bitmap.close(); }
        update({ ...value, backdrop: canvas.toDataURL('image/webp', .78) });
      } catch { setNotice('背景图无法读取。'); }
    }}/></label>
    {value.backdrop && <button type="button" onClick={() => update({ ...value, backdrop: undefined })}>移除背景图</button>}
    <button type="button" onClick={() => update({ ...value, [theme]: look.parse({})[theme] })}>恢复本配色</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
