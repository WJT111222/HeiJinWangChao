import { storyEventNarrations } from './narration';
import { requireStoryData } from '../storyDiagnostics';
import { fingerprint } from '../commands';
import { requireData } from '../common';
import { terminalEvent } from './lifecycle';
import type { GameState } from '../state';
import type { TurnDraft } from '../drafts';
import type { DomainCommand } from '../commands';
type Story = NonNullable<TurnDraft['story']>;

/** Minimal external encounter data only. Pending is not protagonist knowledge. */
export function pendingEventEntries(state: GameState) {
  return Object.values(state.events).flatMap(event => {
    const entry = event.protagonistEntry;
    return entry?.status === 'pending' ? [{eventId:event.id,entryId:entry.id,queuedAt:entry.queuedAt,
      channel:entry.channel,cue:entry.cue,...(entry.locationId ? {locationId:entry.locationId} : {})}] : [];
  }).sort((a,b)=>Date.parse(a.queuedAt)-Date.parse(b.queuedAt)||a.eventId.localeCompare(b.eventId));
}
export function validateStoryEventInteractions(state: GameState, story: Story) {
  storyEventNarrations(state,story);
  const interactions = story.variableGuide.filter(guide=>guide.eventInteraction !== undefined);
  const seen = new Set<string>();
  for(const guide of interactions) {
    const guideIndex = story.variableGuide.indexOf(guide);
    const fieldPath = `variableGuide.${guideIndex}.eventInteraction`;
    const receipt=guide.eventInteraction!,event=state.events[receipt.eventId],entry=event?.protagonistEntry;
    requireStoryData(guide.group==='event' && !seen.has(receipt.eventId) && entry && entry.id===receipt.entryId,
      'EVENT_ENTRY','事件承接回执不存在、重复或已过期', {
        storyRule: guide.group !== 'event' ? 'receipt_group' : seen.has(receipt.eventId) ? 'receipt_duplicate' : 'receipt_reference', guideIndex, fieldPath });
    requireStoryData(!terminalEvent(event) && (entry.status==='pending' || entry.status==='presented'),'EVENT_ENTRY','已关闭的入场不能再次处理', { storyRule: 'receipt_closed', guideIndex, fieldPath });
    requireStoryData(!(entry.status==='presented' && receipt.action==='presented'),'EVENT_ENTRY','已呈现入场不能重播', { storyRule: 'receipt_repeated', guideIndex, fieldPath });
    requireStoryData(guide.textEvidence?.trim(),'EVENT_ENTRY','承接回执说明不能为空', { storyRule: 'receipt_evidence_empty', guideIndex, fieldPath: `variableGuide.${guideIndex}.textEvidence` });
    seen.add(receipt.eventId);
  }
  return interactions;
}
/** Computed from the formal baseline and selected Story, never writes storage. */
export function eventInteractionCommands(state: GameState, draft: TurnDraft, events: Readonly<GameState['events']>): DomainCommand[] {
  if(!draft.story) return [];
  const guides=validateStoryEventInteractions(state,draft.story);
  return guides.map((guide,index)=>{
    const receipt=guide.eventInteraction!,event=events[receipt.eventId],original=state.events[receipt.eventId];
    requireData(event?.protagonistEntry?.id===receipt.entryId,'EVENT_ENTRY','候选不能删除或替换待处理入场');
    requireData(fingerprint(event.protagonistEntry)===fingerprint(original.protagonistEntry)
      && fingerprint(event.protagonistKnowledge)===fingerprint(original.protagonistKnowledge),
      'SCENE_PERMISSION','模型不能改写程序维护的入场或知情快照');
    return {type:'SaveEvent',commandId:`story-entry:${draft.storyRevision}:${index}`,evidence:'所选正文的事件处理回执',
      event:{...event,sourceTurnIds:[...new Set([...event.sourceTurnIds,draft.turnId])],
        protagonistKnowledge:{worldUpdateTurnId:draft.turnId,title:guide.textEvidence!,notice:guide.textEvidence,knowledgeKind:'reported'},
        protagonistEntry:{...event.protagonistEntry,status:receipt.action,handledTurnId:draft.turnId,textEvidence:guide.textEvidence}}};
  });
}
