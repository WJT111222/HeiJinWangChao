import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { DataError } from '../../domain/common';
import type { SaveRepository } from '../../services/storage/saveRepository';

/** instance：存档实例身份（导入备份后才有）；与 state/draft 一起作为下一次人物管理的依据。 */
export type NpcManagementResult = { state: GameState; draft?: TurnDraft; instance?: string };

/** UI adapter only. All identity, CAS, locking and persistence remain in Repository. */
export function changeNpcImportance(repository: SaveRepository, state: GameState, draft: TurnDraft | undefined, npcId: string, instance?: string) {
  const person = state.npc[npcId];
  if (!person) throw new DataError('NPC_MANAGEMENT_CONFLICT', '人物档案已改变');
  return repository.setNpcImportance({
    saveId: state.saveId, expectedRevision: state.revision,
    expectedManagementRevision: state.npcManagementRevision ?? 0,
    expectedDraftRevision: draft?.draftRevision, expectedTurnId: draft?.turnId,
    npcId, identityKey: person.identityKey,
    choice: person.kind === 'special' ? 'ordinary' : 'special',
    operationId: crypto.randomUUID(), expectedInstance: instance ?? null,
  });
}

export function npcManagementError(error: unknown) {
  if (error instanceof DataError && error.code === 'STORY_BUSY')
    return '当前回合正在生成，请完成或取消后再修改人物重要性。';
  if (error instanceof DataError && ['REVISION_CONFLICT', 'DRAFT_CONFLICT', 'NPC_MANAGEMENT_CONFLICT', 'NPC_IDENTITY', 'NPC_KIND'].includes(error.code))
    return '人物或草稿已在其他操作中改变，本次修改未保存。已尝试读取最新资料，请核对后再操作。';
  return '人物重要性未保存，请检查浏览器存储后重试。';
}

/** Do not let a late UI result overwrite a newer turn, preference or candidate. */
export function canAcceptNpcView(current: NpcManagementResult, next: NpcManagementResult) {
  if (current.state.saveId !== next.state.saveId) return false;
  // 同 ID 存档被导入替换后，新时间线的版本号可能更小；以新读取的实例为准。
  if ((current.instance ?? null) !== (next.instance ?? null)) return true;
  if (current.state.revision > next.state.revision ||
      (current.state.npcManagementRevision ?? 0) > (next.state.npcManagementRevision ?? 0)) return false;
  if (current.state.revision < next.state.revision) return true;
  if (!current.draft) return true;
  return current.draft.turnId === next.draft?.turnId && current.draft.draftRevision <= next.draft.draftRevision;
}
