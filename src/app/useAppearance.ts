import { useEffect, useState } from 'react';
import type { Appearance } from '../ui/settings/model';

const lightQuery = '(prefers-color-scheme: light)';

/** 把外观设置解析为实际的日间 / 夜间，并写到根元素的 data-appearance 上；跟随系统时随系统深浅色实时切换。 */
export function resolveAppearance(appearance: Appearance, systemLight: boolean): 'day' | 'night' {
  return appearance === 'system' ? (systemLight ? 'day' : 'night') : appearance;
}

export function useAppearance(appearance: Appearance) {
  const [systemLight, setSystemLight] = useState(() => typeof matchMedia === 'function' && matchMedia(lightQuery).matches);
  useEffect(() => {
    if (appearance !== 'system' || typeof matchMedia !== 'function') return;
    const query = matchMedia(lightQuery), update = () => setSystemLight(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [appearance]);
  const resolved = resolveAppearance(appearance, systemLight);
  useEffect(() => {
    document.documentElement.dataset.appearance = resolved;
    return () => { delete document.documentElement.dataset.appearance; };
  }, [resolved]);
  return resolved;
}
