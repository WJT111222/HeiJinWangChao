import { useSyncExternalStore } from 'react';
import { aiConfigKey, readAiConfig, type ModelRoute } from '../../services/ai/configuration';
import { resolveModelRoute } from '../../services/ai/snapshot';

const subscribe = (notify: () => void) => {
  window.addEventListener('storage', notify);
  return () => window.removeEventListener('storage', notify);
};
const current = () => { try { return localStorage.getItem(aiConfigKey); } catch { return null; } };
export function ModelRouteLabel({ route }: { route: ModelRoute }) {
  useSyncExternalStore(subscribe, current, () => null);
  try {
    const { channel, model } = resolveModelRoute(readAiConfig(localStorage), route);
    return <span className="route-model-label">{channel.name} · <code>{model}</code></span>;
  } catch { return <span className="muted">尚未配置模型</span>; }
}
