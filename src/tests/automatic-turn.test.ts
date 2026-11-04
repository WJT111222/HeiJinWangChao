import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft } from '../domain/drafts';
import { awaitingPlayerAction } from '../domain/turnCommit';
import { AiClient } from '../services/ai/client';
import { record } from '../services/ai/protocols';
import { AiError } from '../services/ai/errors';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { stageResponses, safeResponseText } from '../services/ai/stageResponses';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldDraft, worldNarrative, worldResult } from './fixtures/world';
import { variableReply } from './fixtures/variableReply';

let repo: SaveRepository;
const runners: TurnCoordinator[] = [];
beforeEach(async () => { repo = await SaveRepository.open('auto-turn', new IDBFactory()); await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a', 0, 'opening', 'opening', ''), null); stageResponses.clear(); });
afterEach(() => { runners.forEach(runner => runner.dispose()); runners.length = 0; repo.close(); vi.restoreAllMocks(); stageResponses.clear(); });
function setup() {
  const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://automatic.mock.invalid/v1'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const keys = new Map<string, string>(), store = { getItem: (key: string) => keys.get(key) ?? null, setItem: (key: string, value: string) => { keys.set(key, value); }, removeItem: (key: string) => { keys.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-secret');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
  return { config, vault, settings };
}
const jsonWire = (text: string) => Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
function server() {
  const calls: string[] = []; let badWorld = false;
  const fetcher: typeof fetch = async (_url, init) => {
    const stage = String(record(JSON.parse(String(init?.body))).model); calls.push(stage);
    if (stage === 'story') return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `<thinking>保持场景连续。</thinking><正文>${worldNarrative}</正文><短期记忆>已完成用餐</短期记忆><变量规划>[]</变量规划>` } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    if (stage === 'world') return jsonWire(badWorld ? '{ "eventCommands": [\n invalid }' : JSON.stringify(worldResult()));
    const result = worldDraft().variables!.result; const turn = calls.filter(stage => stage === 'variables').length;
    result.commands = result.commands.map(command => command.type === 'SetWorldClock' ? { ...command, worldClock: `2026-10-18T08:${turn === 1 ? '10' : '20'}:00+08:00` } : command);
    return jsonWire(variableReply(result));
  };
  const runner = new TurnCoordinator(repo, new AiClient(fetcher)); runners.push(runner);
  return { runner, calls, setBad: (value: boolean) => { badWorld = value; } };
}
async function run(value: ReturnType<typeof server>, options = setup()) {
  const draft = await repo.loadDraft('save-a'); if (!draft) throw Error('fixture');
  return generateAndSettleTurn(value.runner, repo, { ...options, draft }, { check: () => undefined, onSettling: () => undefined });
}
describe('真实协调器→自动正式结算→等待玩家', () => {
  it('开局三阶段各一次，自动原子保存并停在空输入草稿，不继续收费', async () => {
    const value = server(), result = await run(value);
    expect(value.calls).toEqual(['story','variables','world']); expect(result.committed?.state.turnNumber).toBe(1);
    expect(result.committed?.state.economy.cash).toBe(7000); expect(result.committed?.draft.userInput).toBe('');
    expect(awaitingPlayerAction((await repo.loadGame('save-a')).state, result.committed?.draft)).toBe(true);
    expect(stageResponses.getSnapshot().find(item => item.stage === 'variables')?.text).toContain('<命令>');
    expect(stageResponses.getSnapshot().every(item => item.status === 'validated')).toBe(true);
  });
  it('玩家下一条行动CAS绑定后再生成普通回合，旧输入不重复，时钟/正文/摘要连续', async () => {
    const value = server(), first = (await run(value)).committed!;
    const bound = await repo.bindTurnAction(first.draft, '在街边吃饭', true, true);
    expect(bound.userInput).toBe('在街边吃饭'); expect((await repo.load('save-a')).revision).toBe(1);
    const second = (await run(value)).committed!;
    expect(second.state.turnNumber).toBe(2); expect(second.state.economy.cash).toBe(4000);
    expect(second.state.journal).toHaveLength(2); expect(second.state.memories.short).toHaveLength(2); expect(second.draft.userInput).toBe('');
    expect(value.calls).toEqual(['story','variables','world','story','variables','world']);
  });
  it('World失败保留上游及完整原文，明确恢复只补World一次再结算', async () => {
    const value = server(); value.setBad(true);
    await expect(run(value)).rejects.toMatchObject({ code: 'invalid_json', details: { worldRule: 'json' } });
    const failure = await repo.loadGame('save-a'); expect(failure.state.revision).toBe(0); expect(failure.draft?.story).toBeDefined(); expect(failure.draft?.variables?.validation).toBe('validated');
    expect(stageResponses.getSnapshot().find(item => item.stage === 'world')).toMatchObject({ status: 'failed', text: '{ "eventCommands": [\n invalid }' });
    value.setBad(false); expect((await run(value)).committed?.state.turnNumber).toBe(1); expect(value.calls).toEqual(['story','variables','world','world']);
  });
  it('保存失败不污染正式状态，恢复完整候选只重新提交，不请求上游', async () => {
    const value = server(), original = repo.commitTurn.bind(repo); vi.spyOn(repo, 'commitTurn').mockRejectedValueOnce(Error('mock storage failure')).mockImplementation(original);
    await expect(run(value)).rejects.toThrow('mock storage failure'); expect((await repo.load('save-a')).turnNumber).toBe(0);
    expect((await repo.loadDraft('save-a'))?.world?.validation).toBe('validated');
    expect((await run(value)).committed?.state.turnNumber).toBe(1); expect(value.calls).toHaveLength(3);
  });
  it('关闭World不自动提交，不伪称完整，恢复开关后只补World', async () => {
    const value = server(), config = setup(); config.settings.runtime.useWorldStage = false;
    expect((await run(value, config)).committed).toBeUndefined(); expect((await repo.load('save-a')).revision).toBe(0); expect(value.calls).toEqual(['story','variables']);
    expect((await run(value)).committed?.state.turnNumber).toBe(1); expect(value.calls).toEqual(['story','variables','world']);
  });
  it('过期输入绑定和同时双绑定只有一个成功，状态不被覆盖', async () => {
    const value = server(), draft = (await run(value)).committed!.draft;
    const result = await Promise.allSettled([repo.bindTurnAction(draft, '行动A', true, true), repo.bindTurnAction(draft, '行动B', true, true)]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(value.calls).toHaveLength(3);
    await expect(repo.bindTurnAction(draft, '第三条行动', true, true)).rejects.toThrow();
    expect((await repo.load('save-a')).turnNumber).toBe(1);
  });
  it('原文按字节顺序保留Unicode和换行，只隐藏凭证；清空后不以规范化结果冒充原文', () => {
    const text = '中文\n<命令>\nset protagonist.emotionText = "安心🟡"\n</命令>';
    expect(safeResponseText(text, [])).toBe(text);
    const protectedText = safeResponseText('Authorization: Bearer private-token\n{"api_key":"other-secret","text":"mock-secret"}', ['mock-secret']);
    expect(protectedText).not.toMatch(/private-token|other-secret|mock-secret/);
    const id = stageResponses.begin({ stage: 'world', saveId: 'save-a', turnId: 'turn-a' }); stageResponses.update(id, { text, normalized: '{}', status: 'validated' }, []);
    expect(stageResponses.getSnapshot()[0].text).toBe(text); stageResponses.clear(); expect(stageResponses.getSnapshot()).toEqual([]);
  });
  it('取消发生在下游启动前时不提交，合法Story/Variables保留', async () => {
    const value = server(), input = setup(), commit = vi.spyOn(repo, 'commitTurn');
    const draft = (await repo.loadDraft('save-a'))!;
    await expect(generateAndSettleTurn(value.runner, repo, { ...input, draft, onProgress: progress => {
      if (progress.stage === 'world' && progress.phase === 'generating') value.runner.cancel();
    } }, { check: () => undefined, onSettling: () => undefined })).rejects.toMatchObject({ code: 'cancelled' });
    expect(commit).not.toHaveBeenCalled(); expect((await repo.load('save-a')).revision).toBe(0);
    const saved = (await repo.loadDraft('save-a'))!; expect(saved.story).toBeDefined(); expect(saved.variables?.validation).toBe('validated'); expect(saved.world).toBeUndefined();
  });
  it('离开页面的有效性检查在结算前失败，不会提交或继续请求', async () => {
    const value = server(), draft = (await repo.loadDraft('save-a'))!, commit = vi.spyOn(repo, 'commitTurn');
    await expect(generateAndSettleTurn(value.runner, repo, { ...setup(), draft }, { check: () => { throw new AiError('cancelled'); }, onSettling: () => undefined })).rejects.toMatchObject({ code: 'cancelled' });
    expect(commit).not.toHaveBeenCalled(); expect((await repo.load('save-a')).turnNumber).toBe(0); expect(value.calls).toHaveLength(3);
  });
  it('生成完成到提交之间正式版本变化时CAS拒绝，不覆盖其他标签的状态', async () => {
    const value = server(), original = repo.commitTurn.bind(repo);
    vi.spyOn(repo, 'commitTurn').mockImplementationOnce(async input => {
      await repo.save('save-a', 0, 'other-tab', [{ type: 'UpdateProtagonist', protagonistId: 'hero', expectedRevision: 0, commandId: 'other', evidence: '其他标签的合法更新', changes: { emotionText: '来自另一标签' } }]);
      return original(input);
    });
    await expect(run(value)).rejects.toThrow();
    const state = await repo.load('save-a'); expect(state.protagonist.emotionText).toBe('来自另一标签'); expect(state.turnNumber).toBe(0); expect(state.economy.cash).toBe(10000); expect(value.calls).toHaveLength(3);
  });
});
