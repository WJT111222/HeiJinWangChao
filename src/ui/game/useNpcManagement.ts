import { DataError } from '../../domain/common';
import { useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { changeNpcImportance, npcManagementError } from './npcManagement';
import type { NpcManagementResult } from './npcManagement';

export function useNpcManagement(repository: SaveRepository, state: GameState, draft: TurnDraft | undefined,
  busy: boolean, onChanged: (result: NpcManagementResult) => void, instance?: string) {
  const lock = useRef(false);
  const [pendingId, setPendingId] = useState<string>();
  const [message, setMessage] = useState('');
  async function change(npcId: string) {
    if (lock.current) return;
    if (busy) { setMessage('当前回合正在生成，请完成或取消后再修改人物重要性。'); return; }
    lock.current = true; setPendingId(npcId); setMessage('');
    try {
      const result = await changeNpcImportance(repository, state, draft, npcId, instance);
      onChanged(result);
      setMessage(`${result.state.npc[npcId].name}：${result.state.npc[npcId].kind === 'special' ? '已设为特殊人物。' : '已取消特殊身份，人物记忆与关系保留。'}`);
    } catch (error) {
      const explanation = npcManagementError(error);
      // A busy stage still owns its live draft; never replace it with a partial reload.
      if (error instanceof DataError && error.code === 'STORY_BUSY') { setMessage(explanation); }
      else {
        try { onChanged(await repository.loadGame(state.saveId)); setMessage(explanation); }
        catch { setMessage(`${explanation} 最新资料暂时无法读取，当前显示保留，请稍后重新读档。`); }
      }
    } finally { lock.current = false; setPendingId(undefined); }
  }
  return { change, pendingId, message };
}
