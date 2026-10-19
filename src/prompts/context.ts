import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { commitCommands } from '../domain/commands';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { initialCompanionProfile, matchesCompanion } from '../services/local/companionProfile';
import type { CompanionProfile } from '../services/local/companionProfile';
import { commandCatalog } from '../services/validation/commandCatalog';
import { AiError } from '../services/ai/errors';
import type { AiStage } from '../services/ai/configuration';

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
    affinity: id === state.initialCompanionId ? null : person.affinity,
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
      MEMORY_CONTEXT: {
        recentTurns: state.journal.slice(-settings.memory.immediateWindowSize).map((entry) => ({
          turnId: entry.turnId,
          narrative: entry.story.narrative,
          summary: entry.story.summary,
        })),
        summaries: [
          ...state.memories.short,
          ...state.memories.medium,
          ...state.memories.long,
        ].filter((memory) => memory.visibility === 'player_known'),
      },
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
      SAVE_STATE: state,
      STORY_RESULT: draft!.story,
      VARIABLE_GUIDE: draft!.story!.variableGuide,
      COMMAND_CATALOG: commandCatalog('variables'),
    };
  if (stage === 'world') {
    const variablePending = !draft?.variables || draft.variables.validation !== 'validated';
    let temporary = state;
    if (!variablePending) {
      try {
        temporary = commitCommands(
          state,
          draft!.turnId,
          state.revision,
          draft!.variables!.result.commands,
          state.updatedAt,
        );
      } catch {
        throw new AiError('invalid_output');
      }
    }
    return {
      BASE_SAVE_REVISION: state.revision,
      worldClock: temporary.worldClock,
      variablePending,
      STORY_RESULT: draft!.story,
      VARIABLE_RESULT: variablePending ? undefined : draft!.variables,
      OFFSCREEN_STATE: {
        npc: Object.values(temporary.npc).filter((npc) => !npc.onScene),
        organizations: temporary.organizations,
        tasks: Object.values(temporary.tasks).filter(
          (task) =>
            task.actorRef.kind === 'organization' ||
            (task.actorRef.kind === 'npc' && !temporary.npc[task.actorRef.id]?.onScene),
        ),
        events: temporary.events,
        locations: temporary.locations,
      },
      COMMAND_CATALOG: commandCatalog('world'),
    };
  }
  if (input.memoryTask === 'memory.npc_summarize') {
    const npc = input.npcId ? state.npc[input.npcId] : undefined;
    if (!npc || !Number.isSafeInteger(input.npcSummaryThreshold) || input.npcSummaryThreshold! <= 0)
      throw new AiError('placeholder');
    return {
      npcId: npc.id,
      memories: npc.memories,
      priorSummaries: state.memories.npcSummaries[npc.id] ?? [],
    };
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
