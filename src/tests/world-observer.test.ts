import { describe, expect, it } from 'vitest';
import { playerView } from '../ui/panels/playerView';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { commitCommands } from '../domain/commands';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { settleTurn } from '../domain/turnCommit';
import { TurnDraftSchema } from '../domain/drafts';
import { migrateSave } from '../services/storage/migrations';
import { GameStateSchema } from '../domain/state';
import { event, organizations, task } from './fixtures/game';
import { worldState, worldDraft, worldResult, proof, actionTime } from './fixtures/world';

describe('玩家全量观察与角色认知分离', () => {
  it.each(['hidden', 'partially_known'] as const)('%s事件及未联系人资料可读，观察不改变角色或Story上下文', visibility => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.events.secret = { ...event('secret'), title: '后台检查', visibility, status: 'active' };
    state.organizations['org-a'] = structuredClone(organizations[3]);
    state.npc['npc-a'].identity = '未接触的医师';
    state.npc['npc-a'].memories = [{ id: 'private', text: '[推测]仓库可能缺货', knowledgeKind: 'suspected', knowledgeSource: '个人猜测',
      sourceTurnIds: [], affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }], createdAtGameTime: state.worldClock, visibility: 'npc_private' }];
    const before = structuredClone(state);
    const input = { stage: 'story' as const, mode: 'opening' as const, state, draft, settings: defaultSettings(), userInput: '' };
    const story = contextFor(input), view = playerView(state);
    expect(view.events).toContainEqual(state.events.secret);
    expect(view.npc.find(n => n.id === 'npc-a')).toMatchObject({ identity: '未接触的医师', memories: state.npc['npc-a'].memories });
    expect(view.organizations).toContainEqual(state.organizations['org-a']);
    expect(view.memories).toContainEqual(expect.objectContaining({ text: '[推测]仓库可能缺货', visibility: 'npc_private' }));
    expect(contextFor(input)).toEqual(story); expect(JSON.stringify(story)).not.toContain('仓库可能缺货');
    expect(state).toEqual(before);
  });
  it.each(['major', 'significant'] as const)('%s已结束事件不能作为普通杂事删除', impact => {
    const state = worldState(); state.events.ended = { ...event('ended'), impact, status: 'resolved', resolvedAt: state.worldClock, resolutionText: '检查完成' };
    expect(() => commitCommands(state, 'cleanup', 0, [{ type: 'DeleteEvent', commandId: 'delete', eventId: 'ended', expectedStatus: 'resolved', reason: '杂事', evidence: '结束' }])).toThrow();
  });
  it('主角相关的普通终态仍保留，不因为minor清除', () => {
    const state = worldState(); state.events.ended = { ...event('ended'), impact: 'minor', status: 'cancelled' };
    expect(() => commitCommands(state, 'cleanup', 0, [{ type: 'DeleteEvent', commandId: 'delete', eventId: 'ended', expectedStatus: 'cancelled', reason: '杂事', evidence: '结束' }])).toThrow();
  });
  it('存在任务引用的普通终态不清理必要因果记录', () => {
    const state = worldState();
    state.events.ended = { ...event('ended'), impact: 'minor', status: 'cancelled', actorRefs: [{ kind: 'npc', id: 'npc-a' }], linkedTaskIds: ['job'] };
    state.tasks.job = { ...task('job'), linkedEventId: 'ended' };
    expect(() => commitCommands(state, 'cleanup', 0, [{ type: 'DeleteEvent', commandId: 'delete', eventId: 'ended', expectedStatus: 'cancelled', reason: '杂事', evidence: '结束' }])).toThrow();
  });
  it('重大场外结案使用已核实facts归档，不要求主角先知晓；不清理完整重要事件', () => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.events.ended = { ...event('ended'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved',
      resolvedAt: state.worldClock, resolutionText: '收到未经核实的举报。', resultKnowledge: { facts: ['收到并登记了一份举报。'], reported: ['仓库可能缺货'], suspected: [] } };
    const result = parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [{ type: 'ArchiveEvent', commandId: 'archive', eventId: 'ended',
      title: '收到并登记了一份举报', summary: '收到并登记了一份举报',
      evidence: proof({ kind: 'established', sources: ['event:ended'], fact: '收到并登记了一份举报。', at: actionTime }) }] }), state, draft);
    const after = projectTurn(state, draft, result.eventCommands);
    expect(after.events.ended).toEqual(state.events.ended);
    expect(playerView(after).timeline).toHaveLength(1);
    expect(JSON.stringify(after.timeline)).not.toContain('仓库可能缺货');
  });
  it('timelineCandidates归档只采用客观facts，不复制结果中的未核实举报；正式记忆仍来自Story', () => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.events.ended = { ...event('ended'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved', sourceTurnIds: [],
      resolvedAt: state.worldClock, resolutionText: '收到举报：北仓藏有违禁品（尚未核实）',
      resultKnowledge: { facts: ['接收并归档了一份举报。'], reported: ['北仓藏有违禁品'], suspected: [] } };
    const result = parseWorld(JSON.stringify({ ...worldResult(), timelineCandidates: ['ended'] }), state, draft);
    const complete = TurnDraftSchema.parse({ ...draft, stageStatus: { ...draft.stageStatus, world: 'ready' }, world: {
      storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, basedOnVariableRevision: 1, validation: 'validated', result,
    } });
    const before = structuredClone(state), after = settleTurn(state, complete, state.updatedAt);
    expect(after.events.ended.visibility).toBe('hidden');
    expect(after.timeline[0].outcome).toBe('接收并归档了一份举报。');
    expect(JSON.stringify(after.timeline)).not.toContain('违禁品');
    expect(after.memories.short.at(-1)?.text).toBe(draft.story!.summary);
    expect(after.npc).toEqual(before.npc); expect(state).toEqual(before);
    for (const facts of [[], undefined]) {
      const invalid = structuredClone(state);
      invalid.events.ended.resultKnowledge = facts ? { facts, reported: ['北仓藏有违禁品'], suspected: [] } : undefined;
      expect(() => parseWorld(JSON.stringify({ ...worldResult(), timelineCandidates: ['ended'] }), invalid, draft)).toThrow();
    }
  });
  it('未核实event-result陈述不能作为归档的established事实', () => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.events.report = { ...event('report'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved',
      resolvedAt: state.worldClock, resolutionText: '听说仓库缺货', resultKnowledge: { facts: ['接收了一份报告'], reported: ['仓库缺货'], suspected: [] } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [{ type: 'ArchiveEvent', commandId: 'false-history',
      eventId: 'report', title: '仓库缺货', summary: '仓库缺货', evidence: proof({ kind: 'established', sources: ['event:report', 'event-result:report'], fact: '仓库缺货' }) }] }), state, draft)).toThrow();
  });
  it('主角事件的后继不会被当作已脱离主线的普通杂事清理', () => {
    const state = worldState();
    state.events.prior = { ...event('prior'), status: 'cancelled' };
    state.events.followup = { ...event('followup'), impact: 'minor', status: 'cancelled', actorRefs: [{ kind: 'npc', id: 'npc-a' }], predecessorEventIds: ['prior'] };
    expect(() => commitCommands(state, 'cleanup', 0, [{ type: 'DeleteEvent', commandId: 'delete', eventId: 'followup', expectedStatus: 'cancelled', reason: '杂事', evidence: '结束' }])).toThrow();
  });
  it.each([1, 2, 3, 4, 5])('V%s旧档不改认知标记、世界时间、来源与历史，可从只读面板查看', version => {
    const original = worldState(); original.events.old = { ...event('old'), status: 'resolved', resolvedAt: original.worldClock, resolutionText: '旧结案原文' };
    original.timeline = [{ eventId: 'old', title: '旧历史', occurredAt: original.worldClock, summary: '旧摘要', outcome: '旧结果', longTermImpact: '', actorRefs: [], sourceTurnIds: [] }];
    const raw: Record<string, unknown> = { ...original, schemaVersion: version };
    if (version < 5) delete raw.retiredEvents;
    if (version < 4) delete raw.contactReviewNpcIds;
    if (version < 3) { delete raw.contactNpcIds; delete raw.retiredNpcs; }
    if (version === 1) { delete raw.weatherText; delete raw.environmentText; }
    const migrated = migrateSave(raw), before = structuredClone(migrated), view = playerView(migrated);
    expect(GameStateSchema.safeParse(migrated).success).toBe(true);
    expect(view.timeline).toEqual(original.timeline); expect(view.events[0].visibility).toBe('hidden');
    expect(migrated).toEqual(before); expect(migrated.worldClock).toBe(original.worldClock); expect(migrated.revision).toBe(original.revision);
    expect(migrated.events).toEqual(original.events);
  });
  it('V5已清理的重要事件成果、原publication和时间线继续可读，后续归档不污染角色知识', () => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.retiredEvents.legacy = { id: 'legacy', status: 'resolved', retiredAt: state.worldClock, sourceTurnIds: [], linkedTaskIds: [], predecessorEventIds: [],
      detail: { title: '旧场外记录', startAt: state.worldClock, resolvedAt: state.worldClock, actorRefs: [{ kind: 'npc', id: 'npc-a' }],
        visibility: 'hidden', impact: 'major', resolutionText: '完成了档案核对。', resultKnowledge: { facts: ['完成了档案核对。'], reported: [], suspected: [] } } };
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    const result = parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [{ type: 'ArchiveEvent', commandId: 'legacy-archive', eventId: 'legacy',
      title: '完成了档案核对', summary: '完成了档案核对', evidence: proof({ kind: 'established', sources: ['event:legacy'], fact: '完成了档案核对。' }) }] }), state, draft);
    const after = projectTurn(state, draft, result.eventCommands), loaded = GameStateSchema.parse(after);
    expect(playerView(loaded).retiredEvents[0].detail).toEqual(state.retiredEvents.legacy.detail);
    expect(playerView(loaded).timeline).toHaveLength(1); expect(loaded.retiredEvents.legacy.publication?.summary).toBe('完成了档案核对');
    expect(loaded.npc).toEqual(state.npc); expect(loaded.events).toEqual({});
  });
});
