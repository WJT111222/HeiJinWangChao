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
  it('旧journal明确交换联系方式但引用为空，不能推定从未联系并批准退场', () => {
    const raw = { ...handoffState(), schemaVersion: 2 }; Reflect.deleteProperty(raw, 'retiredEvents');
    raw.npc['npc-a'].relationshipText = '尚未与主角接触'; raw.npc['npc-a'].affinity = 0;
    raw.journal = [{ turnId: 'past', revision: 1, relatedActorRefs: [],
      story: { ...story, narrative: '主角与同事交换联系方式，约好以后经常联系。', summary: '与同事建立长期联系。' } }];
    raw.turnNumber = 1; raw.revision = 1;
    Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    const state = migrateSave(raw), draft = worldDraft(); draft.baseSaveRevision = state.revision;
    const retirement: Extract<DomainCommand, { type: 'RetireNpc' }> = { ...retireCommand(state), contactReview: { conclusion: 'non_contact', basis: 'no_known_connection', reason: '结构化引用为空。' } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult([retirement]), taskCommands: [finishTask(state)] }), state, draft)).toThrow();
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
  it.each([1, 2, 3, 4])('V%s旧成果原文与终态保留，迁移不伪造认知分类或推进正式版本', (version) => {
    const state = handoffState(); state.tasks.work.status = 'completed';
    state.tasks.work.resolution = { at: state.worldClock, outcome: 'success', result: '收到一份未经核实的举报，声称蓝仓藏有违禁品。', reason: '完成举报登记', sourceTurnId: 'past' };
    const raw = { ...state, schemaVersion: version }; Reflect.deleteProperty(raw, 'retiredEvents');
    if (version < 4) Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    if (version < 3) { Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); }
    if (version === 1) { Reflect.deleteProperty(raw, 'weatherText'); Reflect.deleteProperty(raw, 'environmentText'); }
    const migrated = migrateSave(raw); expect(migrated.tasks).toEqual(state.tasks);
    expect(migrated.revision).toBe(state.revision); expect(migrated.worldClock).toBe(state.worldClock);
    expect(migrated.tasks.work.resolution?.resultKnowledge).toBeUndefined();
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
