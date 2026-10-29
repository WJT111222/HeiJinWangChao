import { requireData } from '../common';
import type { GameState } from '../state';
import type { WorldEvent } from './schema';

type SceneState = Pick<GameState, 'protagonist' | 'npc' | 'events'>;

/** Variables现场权限：只读正式现场与整批合法投影，不从正文或组织归属推断在场。 */
export function validateSceneEventUpdate(before: SceneState, after: SceneState, event: Pick<WorldEvent, 'id' | 'actorRefs'>) {
  const original = before.events[event.id];
  requireData(original, 'SCENE_PERMISSION', '变量只能更新已有现场事件');
  const presentNpc = (id: string) => before.npc[id]?.onScene === true || after.npc[id]?.onScene === true;
  const sceneRelated = original.actorRefs.some(ref =>
    ref.kind === 'protagonist' ? ref.id === before.protagonist.id : ref.kind === 'npc' && presentNpc(ref.id),
  );
  // 一名现场人物不能替混入的纯场外人物授予Variables权限。
  const allNpcsPresent = original.actorRefs.every(ref => ref.kind !== 'npc' || presentNpc(ref.id));
  requireData(sceneRelated && allNpcsPresent, 'SCENE_PERMISSION', '变量只能更新与主角或本幕在场人物相关的现场事件');
}
