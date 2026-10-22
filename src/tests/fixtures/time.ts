import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { createTurnDraft, rerollStory } from '../../domain/drafts';
import { historyState } from './history';
import { event } from './game';

// 隔离的时间推进测试档，不由产品创角或正式存档初始化加载。
export function timeState(withVisitor = false) {
  const state = historyState(1); state.worldClock = '2026-12-31T23:00:00+08:00';
  state.locations.home = { id: 'home', name: '主角住所', parentId: 'chongqing' }; state.protagonist.locationId = 'home';
  if (withVisitor) state.events.visitor = { ...event('visitor'), title: '已约定访客敲门', startAt: '2027-01-01T03:00:00+08:00', estimatedEndAt: '2027-01-01T03:10:00+08:00',
    locationId: 'home', actorRefs: [{ kind: 'protagonist', id: state.protagonist.id }], visibility: 'known', sourceTurnIds: ['history-1'] };
  return GameStateSchema.parse(state);
}
export function timeStory(interrupt = false) {
  const evidence = interrupt ? '凌晨03:00，已约定访客敲门声将你唤醒。' : '次日08:00，你自然醒来。';
  return { turnKind: 'regular' as const, narrative: evidence + '你观察当前局面，尚未决定后续行动。', summary: evidence,
    variableGuide: [{ group: 'time' as const, subjectHint: interrupt ? 'time:interrupt:visitor' : 'time:end', observedFact: interrupt ? '2027-01-01T03:00:00+08:00' : '2027-01-01T08:00:00+08:00', textEvidence: evidence }] };
}
export function timeDraft(state: GameState = timeState(), input = '睡到明天早上8点', interrupt = false) {
  return rerollStory(createTurnDraft(state.saveId, state.revision, 'sleep-turn', 'regular', input), timeStory(interrupt));
}
