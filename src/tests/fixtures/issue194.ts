import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
import type { WorldEvent } from '../../domain/events/schema';
import { GameStateSchema } from '../../domain/state';
import { event } from './game';
import { endStage, mainStage, stageCommand, stageContext, subStage } from './eventStages';
import { worldResult } from './world';

export const handoffDeadline = '2026-05-17T14:00:00+08:00';
const priorTurn = 'prior-entry-turn';
const entryPlan = { channel: '电话', cue: '请核对样本清单', locationId: 'chongqing' };

export function issue194(status: 'presented' | 'pending' = 'presented') {
  const { state } = stageContext();
  const source = {
    ...subStage('handoff-source', '2026-05-17T12:00:00+08:00', handoffDeadline),
    sourceTurnIds: [priorTurn],
    continuation: { direction: 'protagonist', reason: '等待核对', entry: entryPlan },
    protagonistEntry: {
      ...entryPlan, id: 'entry:1:1', sourceTurnId: priorTurn, queuedAt: '2026-05-17T13:15:00+08:00', status,
      ...(status === 'presented' ? { handledTurnId: priorTurn, textEvidence: '合成通知已呈现，仍等待回应。' } : {}),
    },
  } satisfies WorldEvent;
  state.worldClock = '2026-05-17T13:50:00+08:00';
  state.turnNumber = state.revision = 1;
  state.events = {
    'main-stage': { ...mainStage(), startAt: source.startAt, estimatedEndAt: '2026-05-17T16:00:00+08:00' },
    [source.id]: source,
  };
  state.journal = [{ turnId: priorTurn, revision: 1,
    story: { turnKind: 'opening', narrative: '主角开始整理资料。', summary: '整理资料。', variableGuide: [] }, relatedActorRefs: [] }];
  const story = rerollStory(createTurnDraft(state.saveId, 1, 'stage-current', 'regular', '查看资料汇报'), {
    turnKind: 'regular', narrative: '十分钟后，主角打开消息并播放一段汇报语音。', summary: '听取汇报。', variableGuide: [],
  });
  const draft = TurnDraftSchema.parse({ ...story, stageStatus: { ...story.stageStatus, variables: 'ready' },
    variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated',
      result: { commands: [{ type: 'SetWorldClock', commandId: 'handoff-clock', worldClock: handoffDeadline, evidence: '正文经过十分钟' }],
        rejectedSuggestions: [], unresolved: [] } },
  });
  const terminal = endStage(source);
  delete terminal.protagonistEntry;
  const successor = {
    ...event('handoff-next'), title: '核对清单的后续回应', startAt: handoffDeadline, estimatedEndAt: '2026-05-17T15:00:00+08:00',
    actorRefs: source.actorRefs, predecessorEventIds: [source.id], sourceTurnIds: [draft.turnId],
    continuation: { direction: 'protagonist', reason: '保留尚待玩家回应的互动', entry: entryPlan },
  } satisfies WorldEvent;
  const response = worldResult();
  response.visibleHooks = [];
  response.unresolved = [];
  response.eventCommands = [stageCommand(terminal)];
  return { state: GameStateSchema.parse(state), draft, response, source, terminal, successor };
}
