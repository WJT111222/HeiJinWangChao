import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { worldSources } from '../services/validation/worldEvidence';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { initialCompanionProfile, matchesCompanion } from '../services/local/companionProfile';
import type { CompanionProfile } from '../services/local/companionProfile';
import { commandCatalog } from '../services/validation/commandCatalog';
import { AiError } from '../services/ai/errors';
import type { AiStage } from '../services/ai/configuration';
import { npcKnowledgeContext, rawNpcMemories, npcMemoryPolicy, planNpcSummary, npcSummaryInput } from '../domain/memories/npcMemory';
import { storyMemoryContext } from '../domain/memories/publicMemory';

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
  const value = new Date(worldClock);
  if (!Number.isFinite(value.getTime())) throw new AiError('placeholder');
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(
    value,
  );
}
export function checkedInput(input: ComposeInput): ComposeInput {
  try {
    const state = GameStateSchema.parse(input.state);
    const settings = SettingsSchema.parse(input.settings);
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
function publicNpc(state: GameState, id: string, archive?: CompanionProfile) {
  const person = state.npc[id];
  const authored =
    archive && matchesCompanion(state, archive) && archive.npcId === id ? archive : undefined;
  const knownMemories = [
    ...person.memories,
    ...(person.kind === 'special' ? person.longTermMemories : []),
    ...(state.memories.npcSummaries[id] ?? []),
    ...[...state.memories.short, ...state.memories.medium, ...state.memories.long].filter(
      (memory) => memory.affectedEntityRefs.some((ref) => ref.kind === 'npc' && ref.id === id),
    ),
  ].filter((memory) => memory.visibility === 'player_known');
  // 文字字段没有独立可见性标记；只提升与公开记录完整一致的字段，不把否认/传闻中的提及当成确认。
  const knownText = (value?: string) =>
    value?.trim() && knownMemories.some((memory) => memory.text.trim() === value.trim())
      ? value
      : undefined;
  const knownRelationship = knownText(person.relationshipText);
  return {
    id,
    name: authored?.name ?? person.name,
    kind: person.kind,
    onScene: person.onScene,
    locationId: person.onScene ? person.locationId : undefined,
    appearance: person.appearance ?? authored?.profile.appearance,
    temperament: person.temperament ?? authored?.profile.temperament,
    // 叙事人物反应的参考，不把数值当作主角已知事实；初始同伴仍无已确认好感值。
    affinity: id === state.initialCompanionId && !person.affinityConfirmed ? null : person.affinity,
    relationshipText: knownRelationship ?? authored?.relationshipText,
    relationshipSource: knownRelationship
      ? 'player_known_memory'
      : authored
        ? 'creation'
        : undefined,
    healthText: knownText(person.healthText),
    lastInteractionAt: person.lastInteractionAt,
    creationFacts: authored,
    knownMemories: knownMemories.map((memory) => ({
      text: memory.text,
      knowledgeSource: 'knowledgeSource' in memory ? memory.knowledgeSource : undefined,
      createdAtGameTime: memory.createdAtGameTime,
    })),
  };
}
function withoutPrivateMemories(state: GameState): GameState {
  return { ...state, npc: Object.fromEntries(Object.entries(state.npc).map(([id, npc]) => [id, {
    ...npc, memories: [], ...(npc.kind === 'special' ? { longTermMemories: [] } : {}),
    knownInformation: npc.knownInformation.filter((info) => !rawNpcMemories(npc).some((entry) => entry.text === info.text && entry.knowledgeSource === info.source)),
  }])), memories: { ...state.memories, npcSummaries: {} } };
}
const npcKnowledgePolicy = '内部角色认知按ownerNpcId隔离，只属于该人物。亲历/转述/推测/来源未分类不能混同世界真值；总结是历史认知，较新原始记忆中的纠正优先。不能自动传播给其他人物或写入公开线索、正文、日志。总结只能为所属NPC的计划提供参考，不能直接证明完成、到账、关系变化或新增世界事实。';
export function contextFor(input: ComposeInput): Record<string, unknown> {
  const { state, stage, settings, draft } = input;
  if (stage === 'story') {
    const events = Object.values(state.events).filter((event) => event.visibility === 'known');
    const locations = new Set<string>([state.protagonist.locationId]);
    for (const id of [...locations]) {
      let parent = state.locations[id]?.parentId;
      while (parent && !locations.has(parent)) {
        locations.add(parent);
        parent = state.locations[parent]?.parentId;
      }
    }
    const archive = input.companionProfile ?? initialCompanionProfile(state);
    return {
      SAVE_STATE: {
        saveId: state.saveId,
        revision: state.revision,
        turnNumber: state.turnNumber,
        worldClock: state.worldClock,
        protagonist: state.protagonist,
        weatherText: state.weatherText,
        environmentText: state.environmentText,
        economy: {
          ...state.economy,
          properties: Object.fromEntries(
            Object.entries(state.economy.properties).filter(
              ([, asset]) =>
                asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === state.protagonist.id,
            ),
          ),
          vehicles: Object.fromEntries(
            Object.entries(state.economy.vehicles).filter(
              ([, asset]) =>
                asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === state.protagonist.id,
            ),
          ),
          otherAssets: Object.fromEntries(
            Object.entries(state.economy.otherAssets).filter(
              ([, asset]) =>
                asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === state.protagonist.id,
            ),
          ),
        },
        items: Object.values(state.items).filter(
          (item) =>
            item.ownerRef?.kind === 'protagonist' && item.ownerRef.id === state.protagonist.id,
        ),
        locations: Object.values(state.locations).filter((location) => locations.has(location.id)),
      },
      CREATION_PROFILE:
        input.mode === 'opening'
          ? {
              protagonist: state.protagonist,
              companion: archive && matchesCompanion(state, archive) ? archive : undefined,
            }
          : undefined,
      SCENE_NPCS: Object.values(state.npc)
        .filter((npc) => npc.onScene)
        .map((npc) => publicNpc(state, npc.id, archive)),
      MEMORY_CONTEXT: storyMemoryContext(state, settings.memory.immediateWindowSize, input.userInput, input.mode === 'regular'),
      KNOWN_EVENTS: events.map((event) => ({
        id: event.id,
        title: event.title,
        startAt: event.startAt,
        status: event.status,
        resolutionText: event.resolutionText,
      })),
      PLAYER_ACTION: input.userInput,
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
      SELECTED_VARIABLE_DOMAINS: input.domains ?? [],
      SAVE_STATE: withoutPrivateMemories(state),
      NPC_KNOWLEDGE_POLICY: npcKnowledgePolicy,
      NPC_KNOWLEDGE: Object.values(state.npc).filter((npc) => npc.onScene).map((npc) => npcKnowledgeContext(state, npc.id)),
      STORY_RESULT: draft!.story,
      VARIABLE_GUIDE: draft!.story!.variableGuide,
      COMMAND_CATALOG: commandCatalog('variables'),
    };
  if (stage === 'world') {
    const variablePending = !draft?.variables || draft.variables.validation !== 'validated';
    let temporary = state;
    if (!variablePending) {
      try {
        temporary = projectTurn(state, draft!);
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
      BASE_SAVE_REVISION: state.revision,
      worldClock: temporary.worldClock,
      TIME_WINDOW: { from: state.worldClock, to: temporary.worldClock },
      variablePending,
      STORY_RESULT: { narrative: draft!.story!.narrative, summary: draft!.story!.summary },
      VARIABLE_RESULT: variablePending ? undefined : draft!.variables,
      WORLD_SOURCES: worldSources(temporary, draft!, state),
      NPC_KNOWLEDGE_POLICY: npcKnowledgePolicy,
      NPC_KNOWLEDGE: Object.values(temporary.npc).filter((npc) => !npc.onScene && !state.npc[npc.id]?.onScene).map((npc) => npcKnowledgeContext(temporary, npc.id)),
      PROTECTED_SCENE: {
        protagonistId: state.protagonist.id,
        initialCompanionId: state.initialCompanionId,
        sceneNpcIds: [
          ...new Set(
            [...Object.values(state.npc), ...Object.values(temporary.npc)]
              .filter((npc) => npc.onScene)
              .map((npc) => npc.id),
          ),
        ],
      },
      OFFSCREEN_STATE: {
        npc: Object.values(withoutPrivateMemories(temporary).npc).filter(
          (npc) => !npc.onScene && !state.npc[npc.id]?.onScene,
        ),
        organizations: temporary.organizations,
        tasks: Object.values(temporary.tasks).filter(
          (task) =>
            task.actorRef.kind === 'organization' ||
            (task.actorRef.kind === 'npc' &&
              !temporary.npc[task.actorRef.id]?.onScene &&
              !state.npc[task.actorRef.id]?.onScene),
        ),
        events: temporary.events,
        locations: temporary.locations,
      },
      COMMAND_CATALOG: commandCatalog('world'),
    };
  }
  if (input.memoryTask === 'memory.npc_summarize') {
    const npc = input.npcId ? state.npc[input.npcId] : undefined;
    if (!npc || input.npcSummaryThreshold !== npcMemoryPolicy.threshold)
      throw new AiError('placeholder');
    const batch = planNpcSummary(state, npc.id);
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
