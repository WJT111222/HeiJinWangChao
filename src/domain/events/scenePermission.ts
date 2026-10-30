import { requireData } from '../common';
import type { GameState } from '../state';
import type { WorldEvent } from './schema';
import { SceneEventStateSchema } from './schema';
import { fingerprint } from '../commands';

type SceneState = Pick<GameState, 'protagonist' | 'npc' | 'events'>;

/** Variables现场权限：只读正式现场与整批合法投影，不从正文或组织归属推断在场。 */
export function validateSceneEventUpdate(before: SceneState, after: SceneState, event: WorldEvent, turnId: string) {
  const original = before.events[event.id];
  requireData(original, 'SCENE_PERMISSION', '变量只能更新已有现场事件');
  const presentNpc = (id: string) => before.npc[id]?.onScene === true || after.npc[id]?.onScene === true;
  const sceneRelated = original.actorRefs.some(ref =>
    ref.kind === 'protagonist' ? ref.id === before.protagonist.id : ref.kind === 'npc' && presentNpc(ref.id),
  );
  // 一名现场人物不能替混入的纯场外人物授予Variables权限。
  const allNpcsPresent = original.actorRefs.every(ref => ref.kind !== 'npc' || presentNpc(ref.id));
  requireData(sceneRelated && allNpcsPresent, 'SCENE_PERMISSION', '变量只能更新与主角或本幕在场人物相关的现场事件');
  const mutable = new Set<string>([...SceneEventStateSchema.keyof().options, 'sourceTurnIds']);
  const fixed = (value: WorldEvent) => Object.fromEntries(Object.entries(value).filter(([key]) => !mutable.has(key)));
  requireData(fingerprint(fixed(original)) === fingerprint(fixed(event)), 'SCENE_PERMISSION', '变量不能修改事件规划、影响或关联字段');
  const sources = [...new Set([...original.sourceTurnIds, turnId])];
  requireData(fingerprint(event.sourceTurnIds) === fingerprint(sources), 'SCENE_PERMISSION', '现场来源只能由程序保留旧来源并追加本回合');
}
