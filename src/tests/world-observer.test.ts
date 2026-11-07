import { history } from './fixtures/historyRecord';
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
  it.each(['major','significant'] as const)('%s无引用终态可清理，不按重要性限制',impact=>{
 const state=worldState();state.events.ended={...event('ended'),impact,status:'resolved',resolvedAt:state.worldClock,resolutionText:'检查完成'};
 const next=commitCommands(state,'cleanup',0,[{type:'DeleteEvent',commandId:'delete',eventId:'ended',expectedStatus:'resolved',reason:'自然结束',evidence:'结束'}]);
 expect(next.events.ended).toBeUndefined();expect(next.retiredEvents.ended).toBeDefined();
});
  it('主角相关但无未处理入场或引用的终态可清理',()=>{
 const state=worldState();state.events.ended={...event('ended'),impact:'minor',status:'cancelled'};
 expect(commitCommands(state,'cleanup',0,[{type:'DeleteEvent',commandId:'delete',eventId:'ended',expectedStatus:'cancelled',reason:'自然结束',evidence:'结束'}]).events.ended).toBeUndefined();
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
    const result = parseWorld(JSON.stringify({ ...worldResult(), worldCommands: [{type:'RecordHistory',commandId:'archive',evidence:proof({ kind: 'established', sources: ['event:ended'], fact: '收到并登记了一份举报。', at: actionTime }),entry:{id:'archive',eventId:'ended',title:'收到并登记了一份举报',summary:'收到并登记了一份举报',knowledgeKind:'established',actorRefs:[],relatedEntryIds:[]}}] }), state, draft);
    const after = projectTurn(state, draft, result.worldCommands);
    expect(after.events.ended).toEqual(state.events.ended);
    expect(playerView(after).timeline).toHaveLength(1);
    expect(JSON.stringify(after.timeline)).not.toContain('仓库可能缺货');
  });
  it('独立历史保留reported性质；正式记忆仍来自Story且不传播NPC知识',()=>{
 const state=worldState(),draft=worldDraft(true,'opening'),before=structuredClone(state);
 const result=parseWorld(JSON.stringify(worldResult([history('report',{eventId:undefined,summary:'有人声称北仓缺货',knowledgeKind:'reported',sourceText:'来访者',occurredTimeText:'去年'})])),state,draft);
 const complete=TurnDraftSchema.parse({...draft,stageStatus:{...draft.stageStatus,world:'ready'},world:{storyRevision:1,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated',result}});
 const after=settleTurn(state,complete,state.updatedAt);
 expect(after.timeline[0]).toMatchObject({summary:'有人声称北仓缺货',knowledgeKind:'reported',occurredTimeText:'去年'});
 expect(after.memories.short.at(-1)?.text).toBe(draft.story!.summary);expect(after.npc).toEqual(before.npc);expect(state).toEqual(before);
});
  it('归档不解析evidence里的陈述分类，仍只保存事件历史', () => {
    const state = worldState(), draft = worldDraft(true, 'opening');
    state.events.report = { ...event('report'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved',
      resolvedAt: state.worldClock, resolutionText: '听说仓库缺货', resultKnowledge: { facts: ['接收了一份报告'], reported: ['仓库缺货'], suspected: [] } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), worldCommands: [{type:'RecordHistory',commandId:'false-history',evidence:proof({ kind: 'established', sources: ['event:report', 'event-result:report'], fact: '仓库缺货' }),entry:{id:'false-history',eventId:'report',title:'仓库缺货',summary:'仓库缺货',knowledgeKind:'established',actorRefs:[],relatedEntryIds:[]}}] }), state, draft)).not.toThrow();
  });
  it('清理后继可保留轻量前序引用，不因主角相关建立永久门槛',()=>{
 const state=worldState();state.events.prior={...event('prior'),status:'cancelled',resolvedAt:state.worldClock};
 state.events.followup={...event('followup'),impact:'minor',status:'cancelled',actorRefs:[{kind:'npc',id:'npc-a'}],predecessorEventIds:['prior']};
 const after=commitCommands(state,'cleanup',0,[{type:'DeleteEvent',commandId:'delete',eventId:'followup',expectedStatus:'cancelled',reason:'自然结束',evidence:'结束'}]);
 expect(after.retiredEvents.followup.predecessorEventIds).toEqual(['prior']);expect(after.events.prior).toBeDefined();
});
  it.each([1,2,3,4,5])('V%s旧档不迁移且原始数据保持不变',version=>{
 const raw={...worldState(),schemaVersion:version},before=structuredClone(raw);
 expect(()=>migrateSave(raw)).toThrow(expect.objectContaining({code:'UNSUPPORTED_VERSION'}));expect(raw).toEqual(before);
});
  it('新历史可引用已清理的事件身份，不重建完整事件也不污染认知',()=>{
 const state=worldState(),draft=worldDraft(true,'opening');
 state.retiredEvents.retired={id:'retired',status:'resolved',retiredAt:state.worldClock,sourceTurnIds:[],linkedTaskIds:[],predecessorEventIds:[]};
 const result=parseWorld(JSON.stringify(worldResult([history('retired')])),state,draft),after=projectTurn(state,draft,result.worldCommands),loaded=GameStateSchema.parse(after);
 expect(playerView(loaded).timeline).toHaveLength(1);expect(loaded.npc).toEqual(state.npc);expect(loaded.events).toEqual({});
});
});
