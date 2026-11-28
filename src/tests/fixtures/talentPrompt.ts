import { stagedFixture } from './stageScope';
import { GameStateSchema } from '../../domain/state';
import { createTurnDraft, rerollStory } from '../../domain/drafts';
import type { TalentId } from '../../domain/protagonist/talents';
import type { AiStage } from '../../services/ai/configuration';
import type { ComposeInput } from '../../prompts/context';
import { selectVariableDomains } from '../../prompts/variableDomains';
import { defaultSettings } from '../../ui/settings/model';
import { gameTime } from './game';
import { worldState } from './world';

export const talentScenario = '查阅同一家濒临破产、债务复杂并卷入地下纠纷的物流企业公开资料，提出可行路径；暂不签约、不投资、不任职、不公开发声、不押注。';
export const talentNarrative = '经过一分钟，主角核对了物流企业公开资料，尚未作出承诺。';
export const emptyTalentWorld = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] };

/** Stable synthetic input, shared with the isolated approved PR-A baseline. */
export function talentPromptInput(stage: AiStage, mode: 'opening' | 'regular', id?: TalentId, index = 1): ComposeInput & { stage: AiStage } {
  const state = worldState(), settings = defaultSettings();
  state.createdAt = gameTime; state.updatedAt = gameTime; state.openingCityId = 'chongqing';
  if (mode === 'regular') {
    state.turnNumber = index; state.revision = index;
    state.worldClock = new Date(Date.parse(gameTime) + index * 60_000).toISOString();
    state.journal = Array.from({ length: index }, (_, n) => ({ turnId: `talent-history-${n}`, revision: n + 1,
      story: { turnKind: n ? 'regular' as const : 'opening' as const, narrative: '主角阅读了物流企业的公开资料。', summary: '查阅资料', variableGuide: [] }, relatedActorRefs: [] }));
  }
  state.organizations.logistics = { id: 'logistics', kind: 'business', name: '物流企业', description: '企业濒临破产，公开资料涉及债务、地下运输纠纷、数字调度瓶颈、设备效率、机构争执与公众讨论。',
    protagonistRelation: '仅了解公开资料，未任职、未投资、未建立合作', relationHistory: [], keyNpcIds: ['npc-a'], currentTaskIds: [], sectors: ['物流'], businessRelations: [] };
  const person = state.npc['npc-a'];
  person.name = '周衡'; person.identity = '既有地下运输掮客'; person.onScene = false;
  if (person.kind === 'special') { person.activeGoals = ['寻找有能力的运输合作对象']; person.detailedBackground = '曾与主角有过正常业务接触，当前为寻找业务而关注物流企业公开动向。'; }
  if (id !== undefined) state.protagonist.talentId = id;
  const checked = GameStateSchema.parse(state);
  const selected = rerollStory(createTurnDraft(checked.saveId, checked.revision, `talent-${mode}-${index}`, mode, talentScenario), {
    turnKind: mode, narrative: talentNarrative, summary: '核对物流企业公开资料', variableGuide: [],
  });
  const draft = stage === 'world' ? stagedFixture({
    ...selected, variables: { storyRevision: selected.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated',
      result: { commands: [{ type: 'SetWorldClock', commandId: 'talent-time', worldClock: new Date(Date.parse(checked.worldClock) + 60_000).toISOString(), evidence: '经过一分钟' }], rejectedSuggestions: [], unresolved: [] } },
    stageStatus: { ...selected.stageStatus, variables: 'ready' },
  }) : selected;
  settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 5;
  for (const config of Object.values(settings.memory.summaries)) config.automatic = false;
  return { stage, mode, state: checked, draft, settings, userInput: talentScenario,
    ...(stage === 'variables' ? { domains: selectVariableDomains(checked, draft).domains } : {}) };
}

export function talentMemoryInput(task = 'memory.short_to_medium', id?: TalentId): ComposeInput {
  const input = talentPromptInput('story', 'opening', id);
  return { ...input, stage: 'memory', draft: undefined, memoryTask: task,
    ...(task === 'memory.npc_summarize' ? { npcId: 'npc-a', npcSummaryThreshold: input.settings.memory.summaries.npc.threshold } : {}) };
}
