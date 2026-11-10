import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { MemoryMaintenance, summaryAttemptKey } from '../workflows/memoryMaintenance';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { planNpcSummary, parseNpcSummary } from '../domain/memories/npcMemory';
import { migrateSave } from '../services/storage/migrations';
import { composePrompt } from '../prompts/composer';
import { record } from '../services/ai/protocols';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { npc } from './fixtures/game';
import { npcAcceptanceState } from './fixtures/npcAcceptance';
import { legacyNpcMemories, fullPrivateProfile } from './fixtures/npcUnified';
import { npcSummaryOutput } from './fixtures/npcMemory';
import { expectWorldWithNpcProjection, sentContext } from './fixtures/contextAssertions';
import { submission } from './fixtures/turn';

const closed: (() => void)[] = [];
afterEach(() => { closed.splice(0).forEach(close => close()); stageResponses.clear(); });
async function rawStore(factory: IDBFactory, name: string, table: string, operation: (s: IDBObjectStore) => IDBRequest) {
  return new Promise<unknown>((resolve, reject) => {
    const open = factory.open(name); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction(table, 'readwrite'), req = operation(tx.objectStore(table)); let result: unknown;
      req.onsuccess = () => { result = req.result; }; tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  });
}
async function setup(raw: unknown, name: string) {
  const factory = new IDBFactory(), repo = await SaveRepository.open(name, factory); closed.push(() => repo.close());
  await rawStore(factory, name, 'saves', s => s.put(raw));
  const state = await repo.load('save-a'), initial = createTurnDraft(state.saveId, state.revision, `${name}-next`, 'regular', '继续社区合作');
  await repo.saveDraft(initial, null);
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'story'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const data = new Map<string, string>(), store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-only-npc-final');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  return { repo, factory, name, settings, config, vault, initial, state };
}
const reply = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const stream = (content: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const variables = (lines: string[]) => `<thinking>只记录本轮发生的变化。</thinking><说明></说明><命令>\n${lines.join('\n')}\n</命令>`;
const textLine = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
const memoryLine = (id: string, text: string) => `push npc[${id}].memories = ${JSON.stringify({ text, knowledgeKind: 'observed', knowledgeSource: '本轮亲历', visibility: 'npc_private' })}`;
const emptyWorld = () => ({ worldCommands: [] as unknown[], taskCommands: [] as unknown[], eventCommands: [] as unknown[], visibleHooks: [], unresolved: [] });

it('百回合世界继续四轮：建档/改名/升级/离场任务结案/重逢记忆，真实Runtime→候选→Commit→重载→撤回', async () => {
  const a = await setup(npcAcceptanceState(), 'npc-final-life'), calls: string[] = [];
  let round = 0;
  const stories = ['【旁白】林遥介绍自己参与长期社区合作，一名无名路人递来资料后离开。',
    '【旁白】林遥改用林知遥这个名字，接任项目协调，确认合作后离开现场去核对清单。',
    '【旁白】主角留在工作室整理当天的材料，远处的协调事务仍在继续。',
    '【旁白】林知遥回到工作室，谈起已经核验的清单，与主角再次确认合作关系。'];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), stage = String(body.model); calls.push(stage);
    const context = sentContext(body.messages), state = await a.repo.load('save-a'), draft = (await a.repo.loadDraft('save-a'))!;
    const projected = stage === 'world' ? projectTurn(state, draft) : state;
    expectWorldWithNpcProjection(context, projected, state.revision);
    expect(context.NPC_KNOWLEDGE).toBeUndefined(); expect(context.SCENE_NPCS).toBeUndefined();
    if (round === 3) {
      expect(JSON.stringify(context)).toContain('核验结果已确认');
      expect(record(record(context.SAVE_STATE).npc).guest).toMatchObject({ id: 'guest', identityKey: 'identity-guest', kind: 'special' });
    }
    if (stage === 'story') return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `<thinking>承接正式人物经历。</thinking><正文>${stories[round]}</正文><短期记忆>合作与个人经历持续发展。</短期记忆><变量规划>[]</变量规划>` } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const now = record(context.SAVE_STATE).worldClock as string;
    if (stage === 'variables') {
      const lines = [textLine('worldClock', new Date(Date.parse(now) + 60000).toISOString())];
      if (round === 0) {
        const { id, ...fields } = npc('guest'); void id;
        lines.push(textLine('npc[guest]', { ...fields, name: '林遥', age: 28, gender: 'female', identity: '合作协调员', locationId: 'chongqing' }), memoryLine('guest', '首次介绍自己并参与合作。'));
      }
      if (round === 1) lines.push(textLine('npc[guest].specialProfile', { detailedBackground: '在社区成长，学习档案整理后担任合作协调。', activeGoals: ['完成清单核验'], habits: ['复核记录'], offscreenTaskIds: [], relationshipNetwork: [{ name: '许岸', npcId: 'special', relationship: '合作伙伴', description: '共享工作安排', affinity: 36 }] }),
        textLine('npc[guest].privateProfile', fullPrivateProfile), textLine('npc[guest].name', '林知遥'), textLine('npc[guest].aliases', ['林遥']), textLine('npc[guest].identity', '项目协调'),
        textLine('npc[guest].affinity', 42), textLine('npc[guest].relationshipText', '逐渐建立合作信任'), memoryLine('guest', '接任协调职责，准备独立核验清单。'), textLine('npc[guest].onScene', false));
      if (round === 3) lines.push(textLine('npc[guest].onScene', true), textLine('npc[guest].affinity', 48), textLine('npc[guest].relationshipText', '经过合作更为信任'), memoryLine('guest', '返回工作室，说明核验结果已确认。'));
      return reply(variables(lines));
    }
    const world = emptyWorld();
    if (round === 1) {
      expect(record(context.PROTECTED_SCENE).sceneNpcIds).not.toContain('guest');
      world.taskCommands.push({ type: 'SaveTask', commandId: 'start-check', evidence: '离场独立处理工作', task: { id: 'guest-check', actorRef: { kind: 'npc', id: 'guest' }, goal: '核验社区合作清单', startAt: now, dueAt: new Date(Date.parse(now) + 3600000).toISOString(), status: 'active', prerequisites: [], blockers: [] } });
      world.eventCommands.push({ type: 'SaveEvent', commandId: 'start-cooperation', evidence: '共同安排后续合作', event: { id: 'cooperation', title: '清单核验合作', backgroundText: '社区合作需要核验资料', goalText: '核实清单', status: 'active', startAt: now, estimatedEndAt: new Date(Date.parse(now) + 3600000).toISOString(), actorRefs: [{ kind: 'npc', id: 'guest' }], linkedTaskIds: ['guest-check'], prerequisites: [], blockers: [], visibility: 'hidden', impact: 'minor', sourceTurnIds: [draft.turnId] } });
    }
    if (round === 2) {
      world.taskCommands.push({ type: 'SaveTask', commandId: 'finish-check', evidence: '独立核验工作结束', task: { ...state.tasks['guest-check'], status: 'completed', resolution: { at: now, outcome: 'success', result: '核验结果已确认', reason: '工作完成', sourceTurnId: draft.turnId } } });
      world.eventCommands.push({ type: 'SaveEvent', commandId: 'finish-cooperation', evidence: '合作核验已结束', event: { ...state.events.cooperation, status: 'resolved', resolvedAt: now, resolutionText: '核验结果已确认', outcome: 'success', sourceTurnIds: [...state.events.cooperation.sourceTurnIds, draft.turnId], continuation: { direction: 'end', reason: '本阶段核验结束，后续仍可继续合作' } } });
      world.worldCommands.push({ type: 'RecordNpcMemory', commandId: 'private-check', npcId: 'guest', expectedRevision: state.revision, knowledgeKind: 'observed', addToKnownInformation: false, evidence: '本人完成核验', memory: { id: 'offscene-check-memory', text: '核验结果已确认', knowledgeSource: '本人独立完成', visibility: 'npc_private', createdAtGameTime: now, sourceTurnIds: [draft.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'guest' }] } });
      world.worldCommands.push({ type: 'RecordHistory', commandId: 'check-history', evidence: '工作结果', entry: { id: 'check-history', title: '清单核验完成', summary: '核验结果已确认', knowledgeKind: 'established', actorRefs: [{ kind: 'npc', id: 'guest' }], eventId: 'cooperation', relatedEntryIds: [] } });
    }
    if (round === 3) expect(record(context.PROTECTED_SCENE).sceneNpcIds).toContain('guest');
    return reply(JSON.stringify(world));
  });
  const runner = new TurnCoordinator(a.repo, new AiClient(fetcher)); closed.push(() => runner.dispose());
  let draft = a.initial;
  for (round = 0; round < stories.length; round++) {
    const before = await a.repo.load('save-a');
    const outcome = await runner.generate({ ...a, draft }); expect(outcome.status).toBe('complete');
    expect(await a.repo.load('save-a')).toEqual(before);
    const committed = await a.repo.commitTurn(submission(outcome.draft, '继续社区合作')); draft = committed.draft;
    expect((await a.repo.commitTurn(submission(outcome.draft, '继续社区合作'))).replayed).toBe(true);
    expect((await a.repo.loadGame('save-a')).state).toEqual(committed.state);
    expect(Object.keys(committed.state.npc)).toHaveLength(31); // no unnamed passer-by or renamed duplicate
  }
  const final = await a.repo.load('save-a');
  expect(final.turnNumber).toBe(104); expect(final.npc.guest).toMatchObject({ id: 'guest', identityKey: 'identity-guest', kind: 'special', affinity: 48, name: '林知遥', privateProfile: fullPrivateProfile });
  expect(final.npc.guest.memories).toHaveLength(4); expect(new Set(final.npc.guest.memories.map(m => m.id)).size).toBe(4);
  expect(final.tasks['guest-check']).toMatchObject({ actorRef: { id: 'guest' }, linkedEventId: 'cooperation', status: 'completed' });
  expect(final.events.cooperation.status).toBe('resolved'); expect(final.timeline.map(e => e.id)).toContain('check-history');
  expect(final.npc.special.memories).toEqual(a.state.npc.special.memories); expect(final.npc.special.knownInformation).toEqual(a.state.npc.special.knownInformation);
  const undo = await a.repo.undoTurn({ saveId: 'save-a', expectedRevision: final.revision, expectedDraft: draft, operationId: 'undo-reunion' });
  expect(undo.input).toBe('继续社区合作'); expect(undo.state.npc.guest.onScene).toBe(false); expect(undo.state.npc.guest.memories).toHaveLength(3);
  expect(undo.state.tasks['guest-check'].status).toBe('completed'); expect(undo.state.npc.guest).toMatchObject({ privateProfile: fullPrivateProfile });
  expect(calls).toEqual(Array.from({ length: 4 }, () => ['story', 'variables', 'world']).flat());
}, 30000);

it.each([6, 7, 8, 9] as const)('V%s真实读档→Runtime继续→Commit→旧快照按需恢复，来源与七字段不丢失', async version => {
  const legacy = legacyNpcMemories(version === 6 ? 6 : 7);
  const raw = version < 8 ? legacy : { ...migrateSave(legacy), schemaVersion: version };
  const a = await setup(raw, `npc-final-v${version}`), baseline = a.state;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), context = sentContext(body.messages);
    if (body.model === 'story') return stream('<thinking>保持既有经历。</thinking><正文>【旁白】主角整理当日工作，人物各自继续生活。</正文><短期记忆>继续工作。</短期记忆><变量规划>[]</变量规划>');
    if (body.model === 'variables') return reply(variables([textLine('worldClock', new Date(Date.parse(record(context.SAVE_STATE).worldClock as string) + 60000).toISOString())]));
    return reply(JSON.stringify(emptyWorld()));
  });
  const runner = new TurnCoordinator(a.repo, new AiClient(fetcher)); closed.push(() => runner.dispose());
  const result = await runner.generate({ ...a, draft: a.initial }), committed = await a.repo.commitTurn(submission(result.draft, ''));
  const records = await rawStore(a.factory, a.name, 'turnUndo', s => s.getAll()) as { stateJSON: string }[];
  expect(records).toHaveLength(1); records[0].stateJSON = JSON.stringify(raw);
  await rawStore(a.factory, a.name, 'turnUndo', s => s.put(records[0]));
  const control = await rawStore(a.factory, a.name, 'saveControls', s => s.get('save-a')) as { records: { bytes: number }[] };
  control.records[0].bytes = new TextEncoder().encode(JSON.stringify(records[0])).byteLength;
  await rawStore(a.factory, a.name, 'saveControls', s => s.put(control));
  const reopened = await SaveRepository.open(a.name, a.factory); closed.push(() => reopened.close());
  const restored = await reopened.undoTurn({ saveId: 'save-a', expectedRevision: committed.state.revision, expectedDraft: committed.draft, operationId: 'old-restore' });
  expect(restored.state.schemaVersion).toBe(9); expect(restored.state.npc).toEqual(baseline.npc); expect(restored.state.memories).toEqual(baseline.memories);
  expect(restored.state.journal).toEqual(baseline.journal); expect(restored.state.worldClock).toBe(baseline.worldClock);
  expect(restored.state.npc['npc-a']).toMatchObject({ privateProfile: fullPrivateProfile }); expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await reopened.exportRaw('save-a')).records.turnUndo).toHaveLength(0);
}, 15000);

it('长期来源总结与星标相遇：旧epoch拒绝，普通身份可正常总结；恢复不复制资料', async () => {
  const state = npcAcceptanceState(); state.npc.special.memories.push(...Array.from({ length: 10 }, (_, i) => ({ ...state.npc.special.memories[0], id: `extra-${i}` })));
  const a = await setup(state, 'npc-final-summary'), context = await a.repo.loadMemoryContext('save-a'), batch = planNpcSummary(context.state, 'special')!;
  expect(batch.entries).toHaveLength(15);
  const output = parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'maintenance-after-star');
  const managed = await a.repo.setNpcImportance({ saveId: 'save-a', expectedRevision: state.revision, expectedManagementRevision: 0,
    expectedDraftRevision: a.initial.draftRevision, expectedTurnId: a.initial.turnId, npcId: 'special', identityKey: state.npc.special.identityKey, choice: 'ordinary', operationId: 'sleep-special' });
  await expect(a.repo.saveNpcSummary(batch, output, context.lineage)).rejects.toThrow(/时间线已改变/);
  expect(await a.repo.load('save-a')).toEqual(managed.state);
  const current = await a.repo.loadMemoryContext('save-a'), saved = await a.repo.saveNpcSummary(batch, output, current.lineage);
  expect(saved.npc.special.memories).toEqual(state.npc.special.memories); expect(saved.memories.npcSummaries.special).toHaveLength(3);
  for (const stage of ['story', 'variables', 'world'] as const) {
    const draft = rerollStory(managed.draft!, { turnKind: 'regular', narrative: '【旁白】继续交流。', summary: '交流', variableGuide: [] });
    const prompt = await composePrompt({ stage, mode: 'regular', state: saved, draft, settings: a.settings, userInput: '继续交流' });
    const text = JSON.stringify(prompt.messages); expect(text).not.toContain(fullPrivateProfile.firstExperienceText.trim());
    expect(record(record(prompt.context.SAVE_STATE).npc).special).not.toHaveProperty('privateProfile');
    expect(text).not.toContain('dormantNpcProfiles');
  }
  const back = await a.repo.setNpcImportance({ saveId: 'save-a', expectedRevision: saved.revision, expectedManagementRevision: 1,
    expectedDraftRevision: managed.draft!.draftRevision, expectedTurnId: managed.draft!.turnId, npcId: 'special', identityKey: state.npc.special.identityKey, choice: 'special', operationId: 'wake-special' });
  expect(back.state.npc.special).toMatchObject({ privateProfile: fullPrivateProfile }); expect(back.state.memories).toEqual(saved.memories);
  expect(planNpcSummary(back.state, 'special')).toBeUndefined();
});

it('姓名/别名/职业仅Variables正常更新；稳定身份不可赋值，非法类型/空姓名与World越界均拒绝', async () => {
  const a = await setup(npcAcceptanceState(), 'npc-final-rename-boundary');
  const draft = rerollStory(a.initial, { turnKind: 'regular', narrative: '【旁白】林澄正式使用新名字林青，改任社区设计协调。', summary: '人物基本资料变化', variableGuide: [] });
  const lines = [textLine('npc[person].name', '林青'), textLine('npc[person].aliases', ['林澄', '阿澄']), textLine('npc[person].identity', '社区设计协调')];
  const parsed = await parseTextVariables(variables(lines), a.state, draft);
  expect(parsed.commands).toHaveLength(3);
  const projected = projectTurn(a.state, { ...draft, variables: { result: parsed, validation: 'validated', candidateRevision: 1, requestRevision: 0, storyRevision: draft.storyRevision } });
  expect(projected.npc.person).toMatchObject({ id: 'person', identityKey: a.state.npc.person.identityKey, name: '林青', aliases: ['林澄', '阿澄'], identity: '社区设计协调' });
  for (const [field, value] of [['id', 'another'], ['identityKey', 'another'], ['name', ''], ['name', 123], ['aliases', [123]]] as const)
    await expect(parseTextVariables(variables([textLine(`npc[person].${field}`, value)]), a.state, draft)).rejects.toThrow();
  for (const field of ['name', 'aliases', 'identity']) {
    const world = emptyWorld(); world.worldCommands.push({ type: 'UpdateNpc', commandId: `illegal-${field}`, expectedRevision: a.state.revision,
      npcId: 'other', changes: { [field]: field === 'aliases' ? ['新别名'] : '新资料' }, evidence: '场外提议' });
    expect(() => parseWorld(JSON.stringify(world), a.state, draft)).toThrow();
  }
  for (const stage of ['story', 'variables', 'world'] as const) {
    const prompt = await composePrompt({ settings: a.settings, draft, state: a.state, stage, mode: 'regular', userInput: draft.userInput });
    if (stage === 'variables') {
      const catalog = record(prompt.context.TEXT_COMMAND_CATALOG), entries = catalog.entries as { path: string }[];
      for (const field of ['name', 'aliases', 'identity']) expect(entries.some(e => e.path === `npc[id].${field}`)).toBe(true);
    }
    if (stage === 'world') {
      // Actual generated World command schema must not invite these writes.
      const catalog = record(prompt.context.COMMAND_CATALOG), schema = record(catalog.schema);
      const update = (schema.oneOf as Record<string, unknown>[]).find(s => record(record(s.properties).type).const === 'UpdateNpc')!;
      const properties = record(record(record(update.properties).changes).properties);
      for (const field of ['name', 'aliases', 'identity']) expect(properties).not.toHaveProperty(field);
    }
  }
  expect(await a.repo.load('save-a')).toEqual(a.state);
});

it('真实总结HTTP进行中取消星标：迟到结果拒绝，已发请求账本不清空、不自动重试；手动总结仍合法', async () => {
  const state = npcAcceptanceState(); state.npc.special.memories.push(...Array.from({ length: 10 }, (_, i) => ({ ...state.npc.special.memories[0], id: `pending-extra-${i}` })));
  const a = await setup(state, 'npc-final-concurrent-summary'), batch = planNpcSummary(a.state, 'special')!;
  const data = new Map<string, string>(), attempts = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  let sent!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { sent = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async () => { sent(); await gate; return reply(JSON.stringify(npcSummaryOutput(batch))); });
  const maintenance = new MemoryMaintenance(a.repo, new AiClient(fetcher), async (_id, work) => work());
  const input = { saveId: 'save-a', config: a.config, vault: a.vault, timeoutSeconds: 30, kind: 'npc' as const, npcId: 'special', automatic: true, attempts };
  const running = maintenance.run(input), rejection = expect(running).rejects.toThrow(/时间线已改变/);
  await started;
  const managed = await a.repo.setNpcImportance({ saveId: 'save-a', expectedRevision: a.state.revision, expectedManagementRevision: 0, expectedTurnId: a.initial.turnId, expectedDraftRevision: a.initial.draftRevision,
    npcId: 'special', identityKey: a.state.npc.special.identityKey, choice: 'ordinary', operationId: 'star-during-summary' });
  release(); await rejection;
  expect(await a.repo.load('save-a')).toEqual(managed.state); expect(attempts.getItem(summaryAttemptKey(state, 'npc'))).toBeTruthy();
  const rateKey = `heijin.summary.rate:${state.saveId}:${state.createdAt}`;
  expect(JSON.parse(attempts.getItem(rateKey)!)).toHaveLength(1);
  await expect(maintenance.run(input)).rejects.toThrow(/尚未确认保存/); expect(fetcher).toHaveBeenCalledTimes(1);
  const manual = await maintenance.run({ ...input, automatic: false, immediate: true });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(manual!.npc.special.memories).toEqual(state.npc.special.memories);
  expect(manual!.memories.npcSummaries.special).toHaveLength(3); expect(manual!.npc.special.kind).toBe('ordinary');
  expect(manual!.dormantNpcProfiles!.special.profile.privateProfile).toEqual(fullPrivateProfile);
  expect(attempts.getItem(summaryAttemptKey(state, 'npc'))).toBe(''); expect(JSON.parse(attempts.getItem(rateKey)!)).toHaveLength(1);
});
