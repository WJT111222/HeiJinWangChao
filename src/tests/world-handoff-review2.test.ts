import { worldResultForTurn } from './fixtures/world';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { migrateSave } from '../services/storage/migrations';
import { handoffState, finishTask, retireCommand } from './fixtures/handoff';
import { worldDraft, worldResult } from './fixtures/world';
import { story } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';

const repositories: SaveRepository[] = [];
afterEach(() => repositories.splice(0).forEach((repo) => repo.close()));

describe('PR22第二轮先复现：混合成果和未索引旧正文', () => {
  it('待复核人物的历史无索引时仍不批准退场',()=>{
 const state=pendingState();state.journal=[{turnId:'past',revision:1,relatedActorRefs:[],story:{...story,narrative:'过去保持联系',summary:'建立联系'}}];state.turnNumber=1;state.revision=1;const draft=worldDraft();draft.baseSaveRevision=1;
 expect(()=>parseWorld(JSON.stringify({...worldResult([reviewed(state)]),taskCommands:[finishTask(state)]}),state,draft)).toThrow();
});
});

function mixedOutcome(classified = true) {
  const state = handoffState(), raw = worldResult(), command = finishTask(state);
  const secret = '蓝仓暗格藏着违禁货物。', action = '同事接收并归档了一份举报。';
  const evidence = JSON.parse(command.evidence);
  evidence.decision.result = `${action}举报未经核实，原话：${secret}办事员怀疑举报人认错了仓库。`;
  if (classified) evidence.decision.resultKnowledge = { facts: [action], reported: [secret], suspected: ['举报人可能认错了仓库。'] };
  else delete evidence.decision.resultKnowledge;
  command.evidence = JSON.stringify(evidence); raw.taskCommands = [command];
  return { state, raw, action, secret };
}
describe('混合任务成果的认知分层与旧档保留', () => {
  it('V6未分类成果原文和终态读取不补造认知分类',()=>{
 const state=handoffState();state.tasks.work.status='completed';state.tasks.work.resolution={at:state.worldClock,outcome:'success',result:'收到一份未经核实的举报',reason:'登记',sourceTurnId:'past'};
 expect(migrateSave(state)).toEqual(state);expect(migrateSave(state).tasks.work.resolution?.resultKnowledge).toBeUndefined();
});
  it.each(['unknown-field', 'oversized', 'non-text'])('%s认知分类不符合严格Schema，拒绝整个结果', (fault) => {
    const { state, raw } = mixedOutcome(), command = raw.taskCommands[0], evidence = JSON.parse(command.evidence);
    if (fault === 'unknown-field') evidence.decision.resultKnowledge.permissions = 'public';
    if (fault === 'oversized') evidence.decision.resultKnowledge.facts = Array.from({ length: 13 }, () => '事实');
    if (fault === 'non-text') evidence.decision.resultKnowledge.reported = [123];
    if (command.type !== 'SaveTask') throw Error('fixture');
    command.task.resolution!.resultKnowledge = evidence.decision.resultKnowledge;
    expect(() => parseWorld(JSON.stringify(raw), state, worldDraft())).toThrow(); expect(state.tasks.work.resolution).toBeUndefined();
  });
});

function pendingState() {
  const state = handoffState(); state.npc['npc-a'].relationshipText = '尚未与主角接触'; state.npc['npc-a'].affinity = 0;
  state.contactReviewNpcIds = ['npc-a']; return state;
}
function reviewed(state: ReturnType<typeof handoffState>): Extract<DomainCommand, { type: 'RetireNpc' }> {
  return { ...retireCommand(state), contactReview: { conclusion: 'non_contact', basis: 'no_known_connection', reason: '核验现有记录。' } };
}
describe('旧档历史索引不完整不能推断无联系', () => {
  it('真实Composer向世界模型提供玩家确认输入，但不把输入当成世界事实来源', async () => {
    const state = pendingState(), draft = worldDraft(); draft.userInput = '我确认同事只是非联系人临时人员。';
    const composed = await composePrompt({ stage: 'world', mode: 'regular', state, draft, settings: defaultSettings(), userInput: '', domains: ['npc_ordinary'] });
    expect(composed.context.NPC_LIFECYCLE).toMatchObject({ playerConfirmationInput: draft.userInput });
    expect(composed.context).not.toHaveProperty('WORLD_SOURCES');
    expect(composed.messages.some((message) => message.content.includes(draft.userInput))).toBe(true);
  });
  it.each(['journal', 'short', 'medium', 'long'] as const)('%s无关联ID也保守保护，无需程序分析正文关键词', (layer) => {
    const state = pendingState(), draft = worldDraft();
    if (layer === 'journal') {
      state.journal = [{ turnId: 'past', revision: 1, story: { ...story, narrative: '上次见面之后，大家一直保持联系。' }, relatedActorRefs: [] }];
      state.revision = 1; state.turnNumber = 1; draft.baseSaveRevision = 1;
    }
    else state.memories[layer] = [{ id: 'old', text: '两人互留联系方式。', sourceTurnIds: [], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock }];
    const raw = { ...worldResult([reviewed(state)]), taskCommands: [finishTask(state)] };
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(() => parseWorld(JSON.stringify(worldResultForTurn(raw, draft.turnId)), state, draft)).toThrow();
    expect(state.npc['npc-a']).toBeDefined();
  });
  it('没有历史与联系迹象的待确认临时NPC仍能安全退出', () => {
    const state = pendingState(), draft = worldDraft(), raw = { ...worldResult([reviewed(state)]), taskCommands: [finishTask(state)] };
    const result = parseWorld(JSON.stringify(worldResultForTurn(raw, draft.turnId)), state, draft);
    const projected = projectTurn(state, draft, [...result.taskCommands, ...result.worldCommands]);
    expect(projected.npc['npc-a']).toBeUndefined(); expect(state.npc['npc-a']).toBeDefined();
  });
  it('AI写入确认及真实玩家自由文本都不是独立可靠删除授权，旧人继续保护', () => {
    const state = pendingState(), draft = worldDraft();
    state.journal = [{ turnId: 'past', revision: 1, story, relatedActorRefs: [] }];
    state.revision = 1; state.turnNumber = 1; draft.baseSaveRevision = 1;
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    const fact = '主角确认同事属于非联系人临时人员。'; draft.story!.narrative += fact;
    const retirement = reviewed(state); retirement.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: fact, playerConfirmation: fact };
    const evidence = JSON.parse(retirement.evidence); evidence.kind = 'established'; evidence.sources = ['story:current', 'npc:npc-a']; evidence.fact = fact; retirement.evidence = JSON.stringify(evidence);
    const raw = { ...worldResult([retirement]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(worldResultForTurn(raw, draft.turnId)), state, draft)).toThrow();
    draft.userInput = fact;
    expect(() => parseWorld(JSON.stringify(worldResultForTurn(raw, draft.turnId)), state, draft)).toThrow();
    state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = [];
    expect(() => parseWorld(JSON.stringify(worldResultForTurn(raw, draft.turnId)), state, draft)).toThrow();
  });
});
