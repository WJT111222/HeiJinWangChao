import { describe, expect, it } from 'vitest';
import { playerView } from '../ui/panels/playerView';
import { historyState } from './fixtures/history';
import { compressionState } from './fixtures/compression';
import { game, npc } from './fixtures/game';
import { publicShortMemories } from '../domain/memories/publicMemory';
import { compressionCandidates } from '../domain/memories/compression';

describe('玩家四层记忆只读投影', () => {
  it.each([1, 10, 20])('即时窗口N=%s仅选正式journal的最近N回合', (size) => {
    const state = historyState();
    expect(playerView(state, undefined, size)).toMatchObject({
      immediateMemories: state.journal.slice(-size).map((entry, i) => ({ turnId: entry.turnId,
        turnNumber: state.journal.length - size + i + 1, narrative: entry.story.narrative, summary: entry.story.summary })),
    });
  });
  it('不足窗口时保留全部已有历史，原文顺序不倒置', () => {
    expect(playerView(historyState(2), undefined, 20)).toMatchObject({ immediateMemories: [{ turnId: 'history-1' }, { turnId: 'history-2' }] });
  });
  it('新档无正式回合，无即时记忆；不从存档或系统日期捏造历史', () => {
    expect(playerView(game())).toMatchObject({ immediateMemories: [], journal: [] });
  });
  it('短期保存摘要和journal只读摘要明确区分，覆盖规则与候选数不变', () => {
    const state = compressionState('short', 4);
    state.memories.short = state.memories.short.slice(0, 1);
    const before = structuredClone(state), candidates = compressionCandidates(state, 'short');
    const view = playerView(state);
    expect(view.memories[0]).toMatchObject({ tier: 'short', origin: 'stored' });
    expect(view.memories[1]).toMatchObject({ tier: 'short', origin: 'journal' });
    expect(view.memoryLayers.short).toBe(publicShortMemories(state).length);
    expect(compressionCandidates(state, 'short')).toEqual(candidates); expect(state).toEqual(before);
  });
  it('每回合时间只取单一回合正式公开短期记录，旧journal不借当前时钟补齐', () => {
    const state = compressionState('short', 2);
    state.memories.short = state.memories.short.slice(0, 1);
    expect(playerView(state, undefined, 2)).toMatchObject({ immediateMemories: [
      { turnId: 'history-1', createdAtGameTime: state.memories.short[0].createdAtGameTime },
      { turnId: 'history-2', createdAtGameTime: undefined },
    ] });
  });
  it('无摘要的合法旧回合仍保留完整原文，不生成假摘要', () => {
    const state = historyState(1); state.journal[0].story.summary = '';
    expect(playerView(state)).toMatchObject({ immediateMemories: [{ summary: '', narrative: state.journal[0].story.narrative }] });
  });
  it('中长期顺序、完整文本与来源保持原样，全部私有记忆不进入公开投影', () => {
    const state = compressionState('short', 4), base = state.memories.short[0];
    state.memories.medium = [{ ...base, id: 'm-public', text: '完整中期经历'.repeat(100), sourceTurnIds: ['history-1'] },
      { ...base, id: 'm-secret', text: '隐藏的中期秘密', visibility: 'internal' }];
    state.memories.long = [{ ...base, id: 'l-public', text: '完整长期经历'.repeat(100), sourceTurnIds: ['history-2'] },
      { ...base, id: 'l-secret', text: '隐藏的长期秘密', visibility: 'npc_private' }];
    const before = structuredClone(state), view = playerView(state);
    expect(view.memories.filter((entry) => entry.layer === '中期')).toEqual([expect.objectContaining({ tier: 'medium', text: state.memories.medium[0].text, sourceTurnIds: ['history-1'], createdAtGameTime: base.createdAtGameTime })]);
    expect(view.memories.filter((entry) => entry.layer === '长期')).toEqual([expect.objectContaining({ tier: 'long', text: state.memories.long[0].text, sourceTurnIds: ['history-2'] })]);
    expect(JSON.stringify(view)).not.toMatch(/隐藏的中期秘密|隐藏的长期秘密|私有调查/);
    expect(state).toEqual(before);
  });
  it('已压缩历史不因新的阅读分层重新投影为短期', () => {
    const state = compressionState('short', 40), before = structuredClone(state.memories.short);
    state.memories.medium = [{ ...before[0], id: 'compressed', sourceTurnIds: state.journal.slice(0, 30).map((turn) => turn.turnId) }];
    state.memories.short = before.slice(30);
    const view = playerView(state);
    expect(view.memoryLayers).toEqual({ short: 10, medium: 1, long: 0 });
    expect(view.memories.filter((entry) => entry.layer.startsWith('短期'))).toHaveLength(10);
  });
  it('人物在场、联系人或初始同伴身份都不公开其私人原始、长期和总结', () => {
    const state = game();
    const secret = { id: 'private-source', text: '私有经历不可展示', sourceTurnIds: [], affectedEntityRefs: [], visibility: 'npc_private' as const, createdAtGameTime: state.worldClock };
    state.npc.hidden = { ...npc('hidden'), kind: 'special', name: '未公开人物身份', onScene: false,
      detailedBackground: '', activeGoals: [], habits: [], offscreenTaskIds: [],
      memories: [{ ...secret, knowledgeSource: '私人观察' }], longTermMemories: [{ ...secret, id: 'private-long', knowledgeSource: '私人经历' }] };
    state.memories.npcSummaries.hidden = [{ ...secret, id: 'private-summary' }];
    expect(JSON.stringify(playerView(state))).not.toMatch(/私有经历不可展示|未公开人物身份|private-source|private-summary/);
    state.contactNpcIds = ['hidden']; state.initialCompanionId = 'hidden'; state.npc.hidden.onScene = true;
    const view = playerView(state);
    expect(view.memories).toEqual([]); expect(view.memoryLayers).toEqual({ short: 0, medium: 0, long: 0 });
    expect(view.immediateMemories).toEqual([]); expect(view.journal).toEqual([]);
    expect(JSON.stringify(view.memories)).not.toContain('私有经历不可展示');
  });
  it('已合法公开的人物记忆仍可查看，分组不额外复制或提升私有内容', () => {
    const state = historyState(1);
    state.npc['npc-a'].memories = [{ id: 'known-npc-memory', text: '已公开的共同经历', sourceTurnIds: ['history-1'], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock, knowledgeSource: '公开交流' }];
    const view = playerView(state);
    expect(view.memories.filter((entry) => entry.id === 'known-npc-memory')).toEqual([expect.objectContaining({ text: '已公开的共同经历', tier: 'short' })]);
    expect(view.memoryLayers.short).toBe(view.memories.filter((entry) => entry.tier === 'short').length);
  });

});
