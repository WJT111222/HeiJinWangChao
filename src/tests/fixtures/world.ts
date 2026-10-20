import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { GameStateSchema } from '../../domain/state';
import type { DomainCommand } from '../../domain/commands';
import type { WorldEvidence } from '../../services/validation/worldEvidence';
import { game, npc, gameTime } from './game';

export const projectedTime = '2026-10-18T08:10:00+08:00';
export const actionTime = '2026-10-18T08:05:00+08:00';
export const worldNarrative = '经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。';
export function worldState() {
  return GameStateSchema.parse({
    ...game(),
    npc: {
      'npc-a': {
        ...npc(),
        kind: 'special',
        onScene: false,
        detailedBackground: '值班医师',
        activeGoals: ['整理诊室'],
        habits: [],
        longTermMemories: [],
        offscreenTaskIds: [],
      },
      scene: { ...npc('scene'), name: '现场人物' },
    },
  });
}
export function worldDraft(variables = true, mode: 'opening' | 'regular' = 'regular') {
  const draft = rerollStory(createTurnDraft('save-a', 0, 'turn-a', mode, ''), {
    turnKind: mode,
    narrative: worldNarrative,
    summary: '用餐',
    variableGuide: [],
  });
  return TurnDraftSchema.parse({
    ...draft,
    ...(variables
      ? {
          variables: {
            storyRevision: 1,
            candidateRevision: 1,
            requestRevision: 0,
            validation: 'validated',
            result: {
              commands: [
                {
                  type: 'SetWorldClock',
                  commandId: 'clock',
                  worldClock: projectedTime,
                  evidence: '经过十分钟，主角完成用餐。',
                },
                {
                  type: 'SpendFunds',
                  commandId: 'meal',
                  account: 'cash',
                  amount: 3000,
                  purpose: '用餐',
                  evidence: '主角已经用现金支付30元吃饭。',
                },
              ],
              rejectedSuggestions: [],
              unresolved: [],
            },
          },
          stageStatus: { ...draft.stageStatus, variables: 'ready' },
        }
      : {}),
  });
}
export function proof(overrides: Partial<WorldEvidence> = {}) {
  return JSON.stringify({
    version: 1,
    kind: 'derived',
    at: actionTime,
    sources: ['goal:npc-a:0'],
    fact: '同事整理了诊室。',
    rationale: '值班空档内按自身工作目标整理诊室，无关键阻碍。',
    ...overrides,
  });
}
export function npcUpdate(
  changes: Extract<DomainCommand, { type: 'UpdateNpc' }>['changes'] = { healthText: '稍感疲倦' },
): Extract<DomainCommand, { type: 'UpdateNpc' }> {
  return {
    type: 'UpdateNpc',
    commandId: 'offscreen',
    npcId: 'npc-a',
    expectedRevision: 0,
    changes,
    evidence: proof(),
  };
}
export function worldResult(
  worldCommands: DomainCommand[] = [],
): NonNullable<TurnDraft['world']>['result'] {
  return {
    worldCommands,
    taskCommands: [] as DomainCommand[],
    eventCommands: [] as DomainCommand[],
    futureEvents: [],
    visibleHooks: [{ text: '内部候选线索：诊室整理完毕', revealAfter: gameTime }],
    timelineCandidates: [] as string[],
    unresolved: ['财务与物品经营变化尚无场外授权命令，不结算。'],
  };
}
