import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GameState } from '../../domain/state';
import { config, subscribeConfig } from '../../services/images/config';
import { emptyCollection } from '../../services/images/model';
import type { Scope } from '../../services/images/model';
import { imageChange } from '../../services/images/library';
import type { ImageLibrary } from '../../services/images/library';
import { recover, stopLocal } from '../../services/images/queue';
export const enabledSnapshot = () => config().enabled;
export const useImageEnabled = () => useSyncExternalStore(subscribeConfig, enabledSnapshot, () => false);
type Snapshot = Awaited<ReturnType<ImageLibrary['read']>>;
export interface ImageView extends Snapshot {
  lib: ImageLibrary;
  state: GameState;
  scope: Scope;
  error: string;
}
const Context = createContext<ImageView | undefined>(undefined);
export const useImages = () => useContext(Context);
export function ImageScope({
  lib,
  state,
  instance,
  children,
}: {
  lib: ImageLibrary;
  state: GameState;
  instance?: string;
  children: ReactNode;
}) {
  const enabled = useImageEnabled();
  const { saveId, createdAt } = state;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      seq = 0;
    const refresh = () => {
      const version = ++seq;
      void lib.read(saveId).then(
        (next) => {
          if (!disposed && version === seq) {
            setSnapshot(next);
            setError('');
          }
        },
        () => {
          if (!disposed) setError('图片库读取失败，请检查浏览器存储权限');
        },
      );
    };
    const changed = (e: StorageEvent) => {
      if (e.key === imageChange) refresh();
    };
    refresh();
    void recover(lib, { saveId, createdAt, instance }).catch(() => {});
    window.addEventListener(imageChange, refresh);
    window.addEventListener('storage', changed);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      stopLocal(saveId);
      window.removeEventListener(imageChange, refresh);
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, lib, saveId, createdAt, instance]);
  return (
    <Context.Provider
      value={
        enabled
          ? {
              lib,
              state,
              scope: { saveId, createdAt, instance },
              library: snapshot?.library ?? emptyCollection(),
              jobs: snapshot?.jobs ?? [],
              error,
            }
          : undefined
      }
    >
      {children}
    </Context.Provider>
  );
}
