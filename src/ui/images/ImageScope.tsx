import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GameState } from '../../domain/state';
import { config, subscribeConfig } from '../../services/images/config';
import { PictureResources } from './pictureResources';
import { emptyCollection, validTarget } from '../../services/images/model';
import type { Scope, Picture, Kind, Slot } from '../../services/images/model';
import { imageChange, imageTimelineChange } from '../../services/images/library';
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
  resources: PictureResources;
  current: (kind: Kind, id: string, slot: Slot) => Picture | undefined;
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
  const resources = useMemo(
    () => new PictureResources(lib, saveId, instance),
    [lib, saveId, createdAt, instance, enabled],
  );
  useEffect(() => () => resources.clear(), [resources]);
  const current = useMemo(() => {
    const index = new Map<string, Picture>();
    if (enabled && snapshot) {
      const turns = new Set(state.journal.map((j) => j.turnId));
      for (const p of snapshot.library.pictures)
        if (p.current && validTarget(state, p.target, turns))
          index.set(JSON.stringify([p.target.kind, p.target.id, p.slot]), p);
    }
    return (kind: Kind, id: string, slot: Slot) => index.get(JSON.stringify([kind, id, slot]));
  }, [state, snapshot, enabled]);
  const revision = state.revision,
    turnId = state.journal.at(-1)?.turnId;
  useEffect(() => {
    if (!enabled) return;
    void recover(lib, { saveId, createdAt, instance }).catch(() => {});
    return () => stopLocal(saveId);
  }, [lib, saveId, createdAt, instance, enabled]);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(undefined);
      return;
    }
    let disposed = false,
      seq = 0;
    const scope = { saveId, createdAt, instance };
    let verified: Promise<boolean>;
    const refresh = (checkTimeline: boolean) => {
      const version = ++seq;
      if (checkTimeline) verified = lib.matchesView(scope, revision, turnId);
      void (async () => {
        if (!(await verified)) {
          if (!disposed && version === seq) {
            setSnapshot(undefined);
            resources.clear();
            stopLocal(saveId);
            setError('存档时间线已改变，请重新打开存档。');
          }
          return;
        }
        const next = await lib.read(saveId);
        if (!disposed && version === seq) {
          setSnapshot(next);
          setError('');
        }
      })().catch(() => {
        if (!disposed && version === seq) {
          setSnapshot(undefined);
          setError('图片库读取失败，请检查浏览器存储权限');
        }
      });
    };
    const metadata = () => refresh(false),
      timeline = () => refresh(true);
    const changed = (e: StorageEvent) => {
      if (e.key === imageChange) metadata();
      if (e.key === imageTimelineChange || !e.key) timeline();
    };
    timeline();
    window.addEventListener(imageChange, metadata);
    window.addEventListener(imageTimelineChange, timeline);
    window.addEventListener('storage', changed);
    window.addEventListener('focus', timeline);
    return () => {
      disposed = true;
      window.removeEventListener(imageChange, metadata);
      window.removeEventListener(imageTimelineChange, timeline);
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', timeline);
    };
  }, [enabled, lib, resources, saveId, createdAt, instance, revision, turnId]);
  const view = useMemo<ImageView | undefined>(
    () =>
      enabled
        ? {
            lib,
            resources,
            current,
            state,
            scope: { saveId, createdAt, instance },
            library: snapshot?.library ?? emptyCollection(),
            jobs: snapshot?.jobs ?? [],
            error,
          }
        : undefined,
    [enabled, lib, resources, current, state, saveId, createdAt, instance, snapshot, error],
  );
  return <Context.Provider value={view}>{children}</Context.Provider>;
}
