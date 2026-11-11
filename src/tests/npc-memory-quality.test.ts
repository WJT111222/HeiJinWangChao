import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { selectVariableDomains } from '../prompts/variableDomains';
import { composePrompt } from '../prompts/composer';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses } from '../services/ai/stageResponses';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { npcRosterState } from './fixtures/npcRoster';
import { sentContext } from './fixtures/contextAssertions';
import { completeDraft, submission } from './fixtures/turn';
import { fullPrivateProfile } from './fixtures/npcUnified';
import { experiencedMemory, reportedMemory, suspectedMemory, qualityStory, qualityVariables } from './fixtures/npcMemoryQuality';

const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach(r => r.close()); stageResponses.clear(); });
async function seedExisting(factory: IDBFactory, name: string, state: ReturnType<typeof npcRosterState>) {
  // Seed a valid pre-existing world; create() correctly accepts only new games.
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(state);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
const emptyWorld = () => ({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
const markers = ['人物原始记忆内容质量', '事件背景', '具体经过', '本人表现', '个人认知', '最终结果', '持续影响', '40～100', '100～200', '150～300', '信息完整性高于字数', '不是硬性字数门槛', '不复制全知视角', '同一连续事件'];
function expectQuality(text: string) { for (const marker of markers) expect(text).toContain(marker); }

it.each(['opening', 'regular'] as const)('%s实际Variables/World请求使用相同质量标准，不改变协议和权限', async mode => {
  const state = npcRosterState(), settings = defaultSettings();
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'quality-turn', mode, '核对清单'), { turnKind: mode, narrative: qualityStory, summary: '费用暂缓，待核算', variableGuide: [] });
  for (const stage of ['variables', 'world'] as const) {
    const prompt = await composePrompt({ state, draft, settings, stage, mode, domains: stage === 'variables' ? selectVariableDomains(state, draft).domains : [], userInput: draft.userInput });
    const instructions = prompt.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    expectQuality(instructions);
    expect(instructions).toContain('普通和特殊NPC使用相同标准');
    expect(instructions).not.toMatch(/"text":"(?:共同处理了?现场问题|记住共同作出的约定)"/);
    if (stage === 'variables') {
      expect(instructions).toContain('VARIABLE_TEXT_V1'); expect(instructions).toContain('长期离场后重新出现');
      expect(instructions).toContain('npc_ordinary /'); expect(instructions).toContain('npc_special /');
      expect(instructions).toContain('knownInformation');
    } else {
      expect(instructions).toContain('受保护的现场NPC与开局同伴不能通过UpdateNpc、RecordNpcMemory或任务改写');
      expect(instructions).toContain('不额外请求AI');
      expect(instructions).toContain('合法场外行动不要求Story已逐项写出');
    }
    expect(sentContext(prompt.messages).SAVE_STATE).toBeDefined();
  }
});

it('详细记忆经文本编译/候选模拟/World/原子提交/重载原样保留，旧记忆、总结与七字段不变', async () => {
  const factory = new IDBFactory(), name = 'quality-persistence', repo = await SaveRepository.open(name, factory); repositories.push(repo);
  const state = npcRosterState(), before = structuredClone(state); await seedExisting(factory, name, state);
  const initial = createTurnDraft(state.saveId, state.revision, 'quality-save', 'regular', '核对费用'); await repo.saveDraft(initial, null);
  const selected = rerollStory(initial, { turnKind: 'regular', narrative: qualityStory, summary: '暂缓收费', variableGuide: [] });
  // Existing 8192-character protocol boundary remains unchanged; long content is
  // accepted as-is, without a new short-text rejection or a length generator.
  const longText = experiencedMemory + '\n' + '核对记录中逐项保留当时的动作和未决问题。'.repeat(90);
  const text = qualityVariables().replace(JSON.stringify(experiencedMemory), JSON.stringify(longText));
  const variables = await parseTextVariables(text, state, selected);
  expect(variables.commands.filter(c => c.type === 'RecordNpcMemory')).toHaveLength(2);
  const projectedDraft = await completeDraft(repo, { variables, world: emptyWorld(), narrative: qualityStory });
  const projected = projectTurn(state, projectedDraft);
  expect(projected.npc.person.memories.at(-1)?.text).toBe(longText);
  expect(await repo.load(state.saveId)).toEqual(before);
  const world = parseWorld(JSON.stringify(emptyWorld()), state, projectedDraft); expect(world.worldCommands).toEqual([]);
  const committed = await repo.commitTurn(submission(projectedDraft, ''));
  expect(committed.state.npc.person.memories.at(-1)).toMatchObject({ text: longText, knowledgeKind: 'observed', knowledgeSource: '本人亲历交付交涉', visibility: 'npc_private', sourceTurnIds: ['quality-save'], affectedEntityRefs: [{ kind: 'npc', id: 'person' }] });
  expect(committed.state.npc.special.memories.at(-1)).toMatchObject({ text: '[推测]' + suspectedMemory, knowledgeKind: 'suspected', visibility: 'internal' });
  expect(committed.state.npc.special.memories.slice(0, -1)).toEqual(before.npc.special.memories);
  expect(committed.state.memories.npcSummaries).toEqual(before.memories.npcSummaries);
  expect(committed.state.npc.special).toMatchObject({ privateProfile: fullPrivateProfile });
  expect(committed.state.dormantNpcProfiles).toEqual(before.dormantNpcProfiles);
  repo.close(); const reopened = await SaveRepository.open(name, factory); repositories.push(reopened);
  expect(await reopened.load(state.saveId)).toEqual(committed.state);
  // A later distinct experience stays distinct. A new prompt does not rewrite,
  // enrich, merge or automatically duplicate existing short memories.
  const next = rerollStory(committed.draft, { turnKind: 'regular', narrative: '【旁白】收到次日核算时间的通知。', summary: '收到通知', variableGuide: [] });
  const secondText = '<thinking>记录获知。</thinking><说明></说明><命令>push npc[person].memories = '+JSON.stringify({ text: '收到次日核算时间的通知。', knowledgeKind: 'reported', knowledgeSource: '委托方的书面通知', visibility: 'player_known' })+'</命令>';
  const second = await parseTextVariables(secondText, committed.state, next);
  const ready = await completeDraft(reopened, { variables: second, world: emptyWorld(), narrative: next.story!.narrative });
  const saved = await reopened.commitTurn(submission(ready, ''));
  expect(saved.state.npc.person.memories.map(m => m.text)).toEqual([...before.npc.person.memories.map(m => m.text), longText, '[转述]收到次日核算时间的通知。']);
  expect(new Set(saved.state.npc.person.memories.map(m => m.id)).size).toBe(saved.state.npc.person.memories.length);
});

it('真实Coordinator→Runtime→Mock→候选→Commit：亲历/推测/转述分属本人，恰好三次请求', async () => {
  const factory = new IDBFactory(), name = 'quality-runtime', repo = await SaveRepository.open(name, factory); repositories.push(repo);
  const state = npcRosterState(); await seedExisting(factory, name, state);
  const initial = createTurnDraft(state.saveId, state.revision, 'quality-runtime-turn', 'regular', '核对费用'); await repo.saveDraft(initial, null);
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'story'; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-only-quality');
  const calls: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), stage = String(body.model); calls.push(stage);
    if (stage !== 'story') expectQuality(body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content).join('\n'));
    if (stage === 'story') {
      const content = `<thinking>依据已有经历创作。</thinking><正文>${qualityStory}</正文><短期记忆>暂缓收费，待核算。</短期记忆><变量规划>[]</变量规划>`;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    const context = sentContext(body.messages);
    const content = stage === 'variables' ? qualityVariables() : JSON.stringify({ ...emptyWorld(), worldCommands: [{ type: 'RecordNpcMemory', commandId: 'offscreen-message', expectedRevision: state.revision, npcId: 'other', evidence: '离场记者收到消息', addToKnownInformation: false, knowledgeKind: 'reported', memory: { id: 'other-reported', text: '[转述]' + reportedMemory, knowledgeSource: '林澄发来的消息', visibility: 'npc_private', sourceTurnIds: [initial.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'other' }], createdAtGameTime: (context.SAVE_STATE as { worldClock: string }).worldClock } }] });
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  });
  const coordinator = new TurnCoordinator(repo, new AiClient(fetcher));
  try {
    const outcome = await coordinator.generate({ draft: initial, settings, config, vault }); expect(outcome.status).toBe('complete');
    expect((await repo.load('save-a')).npc).toEqual(state.npc);
    const saved = await repo.commitTurn(submission(outcome.draft, ''));
    expect(saved.state.npc.person.memories.at(-1)?.text).toBe(experiencedMemory);
    expect(saved.state.npc.special.memories.at(-1)?.text).toBe('[推测]' + suspectedMemory);
    expect(saved.state.npc.other.memories.at(-1)).toMatchObject({ text: '[转述]' + reportedMemory, knowledgeKind: 'reported', knowledgeSource: '林澄发来的消息', visibility: 'npc_private', sourceTurnIds: [initial.turnId] });
    expect(calls).toEqual(['story', 'variables', 'world']); expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { coordinator.dispose(); }
});

it('简单事实仍可简写，World现场记忆权限不因质量说明扩大', async () => {
  const state = npcRosterState(), initial = createTurnDraft(state.saveId, state.revision, 'short-fact', 'regular', '等回复');
  const draft = rerollStory(initial, { turnKind: 'regular', narrative: '【旁白】林澄点头。', summary: '点头', variableGuide: [] });
  const result = await parseTextVariables('<thinking>简单亲历。</thinking><说明></说明><命令>push npc[person].memories = {"text":"点头","knowledgeKind":"observed","knowledgeSource":"本人亲历","visibility":"npc_private"}</命令>', state, draft);
  expect(result.commands).toHaveLength(1);
  const command = result.commands[0]; expect(command.type).toBe('RecordNpcMemory');
  expect(() => parseWorld(JSON.stringify({ ...emptyWorld(), worldCommands: [command] }), state, draft)).toThrow();
});
