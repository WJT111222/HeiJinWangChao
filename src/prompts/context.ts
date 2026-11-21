import { storyEventIndex } from '../domain/events/narration';
import { stageResults } from '../domain/events/stages';
import { worldNpcAllowed } from '../domain/npc/worldAccess';
import { pendingEventEntries } from '../domain/events/interactions';
import { worldEventSchedule } from '../domain/events/schedule';
import { protagonistKnownEvent } from '../domain/events/knowledge';
import { chinaCalendar, openingTimeBase, openingTimeContext, openingTimeSelection } from '../domain/openingTime';
import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { authorizeLegacyNotificationRecovery } from '../domain/legacyNotificationRecovery';
import type { LegacyNotificationRecovery } from '../domain/events/legacyNotification';
import { fingerprint } from '../domain/commands';
import { projectTurn } from '../domain/turnProjection';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { initialCompanionProfile, matchesCompanion } from '../services/local/companionProfile';
import type { CompanionProfile } from '../services/local/companionProfile';
import { commandCatalog } from '../services/validation/commandCatalog';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { AiError } from '../services/ai/errors';
import type { AiStage } from '../services/ai/configuration';
import { planNpcSummary, npcSummaryInput } from '../domain/memories/npcMemory';
import { sharedContext, storyForSubsequentStages } from './sharedContext';
import { timePreflight, turnTimePolicy, historicalPerspective } from '../domain/timePreflight';

export interface ComposeInput {
  stage: AiStage | 'memory';
  mode: 'opening' | 'regular';
  state: GameState;
  settings: Settings;
  userInput: string;
  draft?: TurnDraft;
  legacyNotificationRecovery?: LegacyNotificationRecovery;
  domains?: string[];
  memoryTask?: string;
  npcId?: string;
  npcSummaryThreshold?: number;
  companionProfile?: CompanionProfile;
  /** Read-only actions retained on this timeline, keyed by journal turn. */
  historyActions?: Record<string,string>;
  orderOverrides?: Record<string, number>;
  orderPreferences?: Record<string, number>;
  cotAllowed?: boolean;
}
export function worldWeekday(worldClock: string) {
  return chinaCalendar(worldClock).weekday;
}
export function checkedInput(input: ComposeInput): ComposeInput {
  try {
    const state = GameStateSchema.parse(input.state);
    const settings = SettingsSchema.parse(input.settings);
    if (state.openingTimePending && input.mode !== 'opening') throw new Error();
    const draft = input.draft ? TurnDraftSchema.parse(input.draft) : undefined;
    if (
      draft &&
      (draft.saveId !== state.saveId ||
        draft.baseSaveRevision !== state.revision ||
        draft.turnKind !== input.mode)
    )
      throw new Error();
    if (
      (input.stage === 'variables' || input.stage === 'world') &&
      (!draft?.story || draft.stageStatus.story !== 'ready')
    )
      throw new Error();
    if (
      (input.stage === 'variables' && !draft?.useVariableStage) ||
      (input.stage === 'world' && !draft?.useWorldStage)
    )
      throw new Error();
    const recovery = input.legacyNotificationRecovery;
    if (recovery) {
      if (input.stage !== 'story' || !draft) throw new Error();
      const { eventId, entryId, notificationOnly, finishReading } = recovery;
      if (fingerprint(authorizeLegacyNotificationRecovery(state,draft,{eventId,entryId,notificationOnly,finishReading}))
        !== fingerprint(recovery)) throw new Error();
    }
    return { ...structuredClone(input), state, settings, draft };
  } catch {
    throw new AiError('configuration');
  }
}
export function contextFor(input: ComposeInput): Record<string, unknown> {
  const { stage, settings, draft } = input;
  const { variableGuideRaw, variableGuideRawTruncated, variableGuideReferences, ...story } = draft?.story ?? {};
  const original = input.state;
  const candidateStage = stage === 'variables' || stage === 'world';
  const selected = candidateStage && original.openingTimePending && draft
    ? openingTimeSelection(original, draft, stage === 'variables' ? [] : undefined) : undefined;
  const state = selected && draft ? openingTimeBase(original, draft) : original;
  const opening = stage === 'story' ? openingTimeContext(original, input.userInput)
    : candidateStage && original.openingTimePending && draft ? selected ? { status: 'candidate', ...selected } : { status: 'pending' } : undefined;
  if (stage === 'story') {
    const events = Object.values(state.events).flatMap((event) => {
      const known = protagonistKnownEvent(event);
      return known ? [known] : [];
    });
    const archive = input.companionProfile ?? initialCompanionProfile(state);
    const preflight = input.mode === 'regular' ? timePreflight(state, input.userInput) : undefined;
    return {
      ...sharedContext(state, settings.memory.immediateWindowSize, input.userInput, input.mode === 'regular'),
      CREATION_PROFILE:
        input.mode === 'opening'
          ? {
              protagonist: state.protagonist,
              companion: archive && matchesCompanion(state, archive) ? archive : undefined,
            }
          : undefined,
      SCENE_NPC_IDS: Object.values(state.npc).filter((npc) => npc.onScene).map(npc=>npc.id),
      KNOWN_EVENTS: events,
      EVENT_NARRATION_INDEX:storyEventIndex(state),
      EVENT_ENTRIES: pendingEventEntries(state),
      EVENT_PARTICIPATION: Object.values(state.events).flatMap(event=>event.protagonistEntry?.status==='presented' && !['resolved','cancelled'].includes(event.status)
        ? [{eventId:event.id,entryId:event.protagonistEntry.id,status:'presented',...(event.entryIntent ? {entryIntent:event.entryIntent} : {})}] : []),
      ...(input.legacyNotificationRecovery ? {
        LEGACY_NOTIFICATION_RECOVERY: {
          eventId:input.legacyNotificationRecovery.eventId, entryId:input.legacyNotificationRecovery.entryId,
          playerAction:'玩家确认此入场仅是无需决定的通知，并选择在本幕读完或听完这条通知，仅收悉。',
          previousStory:storyForSubsequentStages(draft!.story!),
          rule:'重做当前未结算正文，保留已绑定行动与旧选定正文已成立的事实，原样保留其他事件的结构化裁定。明确写出实际读完或听完这条已呈现通知的过程。确实收悉时，只给指定旧入场补交 group=event、eventInteraction.action=acknowledged 及实际 textEvidence。仅呈现或开始播放不够。如果内容实际仍要求批准、选择、回应或参与，即使玩家将它选为纯通知，也不要提交收悉回执。此授权不分类其他事件，不接受、批准、拒绝或执行任何待决事项。不要改变时钟约束或凭空补充未收到的内容。',
        },
      } : {}),
      PLAYER_ACTION: input.userInput,
      OPENING_TIME: opening,
      TURN_TIME_POLICY: turnTimePolicy,
      TIME_PREFLIGHT: preflight ? {
        ...preflight,
        candidates: preflight.candidates.map((candidate) => ({ ...candidate, weekday: worldWeekday(candidate.at) })),
        calendar: { fromWeekday: worldWeekday(state.worldClock),
          targetWeekday: preflight.targetAt ? worldWeekday(preflight.targetAt) : undefined,
          earliestWeekday: preflight.endWindow ? worldWeekday(preflight.endWindow.from) : undefined,
          latestWeekday: preflight.endWindow ? worldWeekday(preflight.endWindow.to) : undefined },
        basis: { saveId: state.saveId, revision: state.revision, turnId: draft?.turnId,
          draftRevision: draft?.draftRevision, storyRevision: draft?.storyRevision,
          worldClock: state.worldClock, locationId: state.protagonist.locationId },
      } : undefined,
    };
  }
  if (stage === 'variables')
    return {
      TURN_CONTEXT: {
        turnId: draft!.turnId,
        turnKind: draft!.turnKind,
        baseSaveRevision: draft!.baseSaveRevision,
        storyRevision: draft!.storyRevision,
        executionRevision: draft!.executionRevision,
        requestRevision: draft!.stageRequestRevisions.variables,
      },
      OPENING_TIME: opening,
      TURN_TIME_POLICY: turnTimePolicy,
      HISTORICAL_PERSPECTIVE: historicalPerspective(state, draft!),
      PLAYER_ACTION: draft!.userInput,
      SELECTED_VARIABLE_DOMAINS: input.domains ?? [],
      ...sharedContext(selected ? { ...state, worldClock: selected.endAt } : state,
        settings.memory.immediateWindowSize, draft!.userInput, input.mode === 'regular', {
          stage: 'variables', playerInput: draft!.userInput, storyText: draft!.story!.narrative, variableGuide: draft!.story!.variableGuide,
        }),
      STORY_RESULT: story,
      ...(variableGuideRaw !== undefined ? { VARIABLE_GUIDE_NOTES: variableGuideRaw,
        ...(variableGuideRawTruncated ? { VARIABLE_GUIDE_NOTES_TRUNCATED: true } : {}) } : {}),
      VARIABLE_GUIDE: draft!.story!.variableGuide,
      ...(variableGuideReferences ? { VARIABLE_GUIDE_REFERENCES: variableGuideReferences } : {}),
      TEXT_COMMAND_CATALOG: textVariableCatalog(),
      NPC_IMPORTANCE: Object.values(state.npc).map(npc=>({npcId:npc.id,identityKey:npc.identityKey,kind:npc.kind,playerPreference:npc.importancePreference??'automatic',profilePending:npc.kind==='special'&&Boolean(npc.profilePending),canRestoreProfile:Boolean(state.dormantNpcProfiles?.[npc.id])})),
    };
  if (stage === 'world') {
    if (original.openingTimePending && !selected)
      throw new AiError('time_data', undefined, { storyRule: 'opening_missing', fieldPath: 'worldClock' });
    const variablePending = !draft?.variables || draft.variables.validation !== 'validated';
    let temporary = original.openingTimePending ? projectTurn(original, draft!) : state;
    if (!variablePending) {
      try {
        temporary = projectTurn(original, draft!);
      } catch {
        throw new AiError('invalid_output');
      }
    }
    return {
      TURN_CONTEXT: {
        turnId: draft!.turnId,
        turnKind: draft!.turnKind,
        baseSaveRevision: state.revision,
        storyRevision: draft!.storyRevision,
        executionRevision: draft!.executionRevision,
        requestRevision: draft!.stageRequestRevisions.world,
        basedOnVariableRevision: draft!.variables?.candidateRevision,
      },
      OPENING_TIME: opening,
      TURN_TIME_POLICY: turnTimePolicy,
      HISTORICAL_PERSPECTIVE: historicalPerspective(state, draft!),
      BASE_SAVE_REVISION: state.revision,
      worldClock: temporary.worldClock,
      TIME_WINDOW: { from: state.worldClock, to: temporary.worldClock },
      EVENT_SCHEDULE: historicalPerspective(state,draft!) ? {readOnly:true,policy:'纯过去视角只读，不处理当前世界到期事件；原排程保留到正常世界回合。'} : worldEventSchedule(state, temporary),
      variablePending,
      PLAYER_ACTION: draft!.userInput,
      STORY_RESULT: { ...storyForSubsequentStages(draft!.story!), eventInteractions: draft!.story!.variableGuide.filter(guide=>guide.eventInteraction), eventNarrations: draft!.story!.variableGuide.filter(guide=>guide.eventNarration) },
      VARIABLE_RESULT: variablePending ? undefined : draft!.variables,
      // 投影提供候选内容，不产生新的正式版本；模型的expectedRevision仍须使用正式基线。
      ...sharedContext({ ...temporary, revision: original.revision }, settings.memory.immediateWindowSize, draft!.userInput, input.mode === 'regular', {
        stage: 'world', playerInput: draft!.userInput, storyText: draft!.story!.narrative, variableGuide: storyForSubsequentStages(draft!.story!).variableGuide,
        validatedVariables: variablePending ? undefined : draft!.variables!.result, from: state.worldClock,
      }),
      PROTAGONIST_PROFILE: temporary.protagonist,
      PROTECTED_SCENE: {
        protagonistId: state.protagonist.id,
        initialCompanionId: state.initialCompanionId,
        sceneNpcIds: [
          ...new Set(
            Object.values(temporary.npc)
              .filter((npc) => !worldNpcAllowed(temporary, draft!, npc.id))
              .map((npc) => npc.id),
          ),
        ],
      },
      NPC_LIFECYCLE: { contactNpcIds: temporary.contactNpcIds, initialCompanionId: temporary.initialCompanionId,
        policy: '所有已正式建档的NPC永久保留完整人物、记忆和关系，离场、死亡或失联不是删除。contactNpcIds只是联系人登记，不推断已知电话。' },
      EVENT_STAGE_RESULTS:Object.fromEntries([...Object.values(temporary.events),...Object.values(temporary.retiredEvents)]
        .filter(e=>e.eventKind==='main').map(e=>[e.id,stageResults(temporary,e.id)])),
      OFFSCREEN_STATE: {
        npcIds: Object.values(temporary.npc).filter(
          (npc) => worldNpcAllowed(temporary, draft!, npc.id),
        ).map(npc=>npc.id),
        organizations: temporary.organizations,
        tasks: Object.values(temporary.tasks).filter(
          (task) =>
            (task.actorRef.kind === 'organization' ||
            (task.actorRef.kind === 'npc' &&
              worldNpcAllowed(temporary, draft!, task.actorRef.id))),
        ),
        events: temporary.events,
        history: temporary.timeline,
        retiredEvents: Object.fromEntries(Object.entries(temporary.retiredEvents).filter(([,record])=>record.detail)),
        locations: temporary.locations,
      },
      COMMAND_CATALOG: commandCatalog('world'),
    };
  }
  if (input.memoryTask === 'memory.npc_summarize') {
    const npc = input.npcId ? state.npc[input.npcId] : undefined;
    if (!npc || input.npcSummaryThreshold !== settings.memory.summaries.npc.threshold)
      throw new AiError('placeholder');
    const batch = planNpcSummary(state, npc.id, { config: settings.memory.summaries.npc });
    return { MEMORY_TASK: batch ? npcSummaryInput(batch) : { task: 'memory.npc_summarize', npcId: npc.id, groups: [] } };
  }
  return {
    MEMORY_CONTEXT: state.memories,
    journal: state.journal.map((entry) => ({
      turnId: entry.turnId,
      narrative: entry.story.narrative,
    })),
  };
}
export { contextMessage } from './contextMessage';
