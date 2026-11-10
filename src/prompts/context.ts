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
import { sharedContext } from './sharedContext';
import { timePreflight, turnTimePolicy, historicalPerspective } from '../domain/timePreflight';

export interface ComposeInput {
  stage: AiStage | 'memory';
  mode: 'opening' | 'regular';
  state: GameState;
  settings: Settings;
  userInput: string;
  draft?: TurnDraft;
  domains?: string[];
  memoryTask?: string;
  npcId?: string;
  npcSummaryThreshold?: number;
  companionProfile?: CompanionProfile;
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
    return { ...structuredClone(input), state, settings, draft };
  } catch {
    throw new AiError('configuration');
  }
}
export function contextFor(input: ComposeInput): Record<string, unknown> {
  const { stage, settings, draft } = input;
  const original = input.state;
  const candidateStage = stage === 'variables' || stage === 'world';
  const state = candidateStage && original.openingTimePending && draft ? openingTimeBase(original, draft) : original;
  const opening = stage === 'story' ? openingTimeContext(original, input.userInput)
    : candidateStage && original.openingTimePending && draft ? { status: 'candidate', ...openingTimeSelection(original, draft) } : undefined;
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
      SCENE_NPCS: Object.values(state.npc).filter((npc) => npc.onScene),
      KNOWN_EVENTS: events,
      EVENT_NARRATION_INDEX:storyEventIndex(state),
      EVENT_ENTRIES: pendingEventEntries(state),
      EVENT_PARTICIPATION: Object.values(state.events).flatMap(event=>event.protagonistEntry?.status==='presented' && !['resolved','cancelled'].includes(event.status)
        ? [{eventId:event.id,entryId:event.protagonistEntry.id,status:'presented'}] : []),
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
      ...sharedContext(opening?.status === 'candidate' ? { ...state, worldClock: openingTimeSelection(original, draft!)!.endAt } : state,
        settings.memory.immediateWindowSize, draft!.userInput, input.mode === 'regular', {
          stage: 'variables', playerInput: draft!.userInput, storyText: draft!.story!.narrative, variableGuide: draft!.story!.variableGuide,
        }),
      STORY_RESULT: draft!.story,
      VARIABLE_GUIDE: draft!.story!.variableGuide,
      TEXT_COMMAND_CATALOG: textVariableCatalog(),
    };
  if (stage === 'world') {
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
      STORY_RESULT: { ...draft!.story!, eventInteractions: draft!.story!.variableGuide.filter(guide=>guide.eventInteraction), eventNarrations: draft!.story!.variableGuide.filter(guide=>guide.eventNarration) },
      VARIABLE_RESULT: variablePending ? undefined : draft!.variables,
      // 投影提供候选内容，不产生新的正式版本；模型的expectedRevision仍须使用正式基线。
      ...sharedContext({ ...temporary, revision: original.revision }, settings.memory.immediateWindowSize, draft!.userInput, input.mode === 'regular', {
        stage: 'world', playerInput: draft!.userInput, storyText: draft!.story!.narrative, variableGuide: draft!.story!.variableGuide,
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
      NPC_LIFECYCLE: { contactNpcIds: temporary.contactNpcIds, contactReviewNpcIds: temporary.contactReviewNpcIds, initialCompanionId: temporary.initialCompanionId,
        playerConfirmationInput: draft!.userInput, // 仅保留输入数据兼容；不是已发生事实或删除授权。
        retiredIdentities: temporary.retiredNpcs, policy: '所有已正式建档的NPC永久保留完整人物、记忆和关系，离场、死亡或失联不是删除。contactNpcIds/contactReviewNpcIds仅兼容旧登记，不推断已知电话。旧retiredNpcs保持历史身份，不凭空恢复档案。' },
      EVENT_STAGE_RESULTS:Object.fromEntries([...Object.values(temporary.events),...Object.values(temporary.retiredEvents)]
        .filter(e=>e.eventKind==='main').map(e=>[e.id,stageResults(temporary,e.id)])),
      OFFSCREEN_STATE: {
        npc: Object.values(temporary.npc).filter(
          (npc) => worldNpcAllowed(temporary, draft!, npc.id),
        ),
        organizations: temporary.organizations,
        tasks: Object.values(temporary.tasks).filter(
          (task) =>
            (task.actorRef.kind === 'organization' ||
            (task.actorRef.kind === 'npc' &&
              (worldNpcAllowed(temporary, draft!, task.actorRef.id)
                // Retired actors cannot act again, but their terminal results remain available for handoffs.
                || (temporary.retiredNpcs[task.actorRef.id] && ['completed','cancelled'].includes(task.status))))),
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
export function contextMessage(context: Record<string, unknown>) {
  // 容器作为 user 数据，转义尖括号避免角色卡通过闭合标签伪造容器。
  const json = JSON.stringify(context).replace(
    /[<>&]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `<GAME_CONTEXT>\n${json}\n</GAME_CONTEXT>`;
}
