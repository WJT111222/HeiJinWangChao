import { requireStoryData } from '../storyDiagnostics';
import { requireData } from '../common';
import { terminalEvent } from './lifecycle';
import type { GameState } from '../state';
import type { TurnDraft } from '../drafts';
import type { DomainCommand } from '../commands';
type Story = NonNullable<TurnDraft['story']>;

/** Author decisions reference formal identities. They neither consume an entry nor grant knowledge. */
export function storyEventNarrations(state:GameState,story:Story) {
  const guides=story.variableGuide.filter(g=>g.eventNarration);
  const seen=new Set<string>();
  for(const guide of guides) {
    const n=guide.eventNarration!,e=state.events[n.eventId],at=Date.parse(n.at);
    const activeEntry=e?.protagonistEntry && ['pending','presented'].includes(e.protagonistEntry.status);
    const guideIndex=story.variableGuide.indexOf(guide),fieldPath=`variableGuide.${guideIndex}.eventNarration`;
    requireStoryData(guide.group==='event' && e && !seen.has(n.eventId) && !guide.eventInteraction && (n.mode!=='enter'||!activeEntry),
      'EVENT_ENTRY','事件叙事裁定引用不存在、重复或混用旧回执',{storyRule:'narration_reference',guideIndex,fieldPath});
    requireStoryData(at>=Date.parse(state.worldClock) && at>=Date.parse(e.startAt)
      && (n.mode!=='enter'||!terminalEvent(e)), 'EVENT_ENTRY','事件叙事裁定时间或入场状态无效',
      {storyRule:'narration_time',guideIndex,fieldPath});
    requireStoryData(!story.variableGuide.some(g=>g.group==='time'&&g.subjectHint==='time:retrospective'),
      'EVENT_ENTRY','纯历史视角不能声明当前事件接触',{storyRule:'narration_time',guideIndex,fieldPath});
    seen.add(n.eventId);
  }
  return guides;
}
export interface SceneIntervention {eventId:string;at:string}
/** Ephemeral capability scoped to Variables command IDs, derived again from selected Story at every boundary. */
export function storySceneAuthority(state:GameState,draft:Pick<TurnDraft,'story'>,commands:readonly DomainCommand[]) {
  const entered=new Map((draft.story?storyEventNarrations(state,draft.story):[])
    .flatMap(g=>g.eventNarration?.mode==='enter'?[[g.eventNarration.eventId,g.eventNarration] as const]:[]));
  return new Map(commands.flatMap(c=>c.type==='SaveEvent' && entered.has(c.event.id)
    ? [[c.commandId,entered.get(c.event.id)!] as const]:[]));
}
export function validateNarrationClock(state:GameState,draft:Pick<TurnDraft,'story'>,clock:string) {
  for(const guide of draft.story?storyEventNarrations(state,draft.story):[])
    requireData(Date.parse(guide.eventNarration!.at)<=Date.parse(clock),'TIME_PREFLIGHT','时钟未到Story实际事件接触时刻');
}
/** Compact identity/time index; full records already live in SAVE_STATE, not copied here. */
export function storyEventIndex(state:GameState) {
  return Object.values(state.events).map(e=>({eventId:e.id,eventKind:e.eventKind,parentEventId:e.parentEventId,
    status:e.status,startAt:e.startAt,fixedEndAt:e.fixedEndAt,estimatedEndAt:e.estimatedEndAt,
    actorRefs:e.actorRefs,locationId:e.locationId,visibility:e.visibility,protagonistEntry:e.protagonistEntry?{id:e.protagonistEntry.id,status:e.protagonistEntry.status,queuedAt:e.protagonistEntry.queuedAt,channel:e.protagonistEntry.channel,cue:e.protagonistEntry.cue,locationId:e.protagonistEntry.locationId}:undefined,
    protagonistKnowledge:e.protagonistKnowledge}));
}
