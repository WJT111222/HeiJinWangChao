import { openingTimeBase, openingTimeSelection } from './openingTime';
import { commitCommands } from './commands';
import type { DomainCommand } from './commands';
import type { TurnDraft } from './drafts';
import type { GameState } from './state';
import { requireData } from './common';

// 唯一开局时钟命令：既不持久化第二份候选，也不要求变量模型重复证明时间。
// 旧草稿的等值SetWorldClock兼容为同一程序命令；不同值是数据冲突，不能静默丢弃。
export function variableCommandsForTurn(state: GameState, draft: TurnDraft, commands: readonly DomainCommand[]): DomainCommand[] {
  const selected = openingTimeSelection(state, draft);
  if (!selected) return [...commands];
  requireData(commands.filter((c) => c.type === 'SetWorldClock').every((c) => Date.parse(c.worldClock) === Date.parse(selected.endAt)),
    'OPENING_TIME', '变量时钟与Story开局候选冲突');
  const command: DomainCommand = { type: 'SetWorldClock', commandId: `opening-clock:${draft.storyRevision}`,
    worldClock: selected.endAt, evidence: 'Story结构化开局时间' };
  return [command, ...commands.filter((c) => c.type !== 'SetWorldClock')];
}
// 每份内存投影都从同一正式基线开始。不能把模拟产生的 revision 当作新正式版本。
export function projectTurn(state: GameState, draft: TurnDraft, worldCommands: readonly DomainCommand[] = []) {
  const variables = draft.variables?.validation === 'validated' ? draft.variables.result.commands : [];
  return commitCommands(openingTimeBase(state, draft), draft.turnId, state.revision,
    [...variableCommandsForTurn(state, draft, variables), ...worldCommands], state.updatedAt);
}
