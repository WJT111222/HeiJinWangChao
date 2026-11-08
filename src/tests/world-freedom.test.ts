import { expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { validateStoryEventInteractions } from '../domain/events/interactions';
import { parseWorld } from '../services/validation/aiOutputs';
import { game, npc, event, task, story } from './fixtures/game';

const later = '2026-10-19T08:00:00+08:00';
function setup() {
  const state = game(); state.npc.a = { ...npc('a'), onScene: false }; state.npc.b = { ...npc('b'), onScene: false };
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'opening', ''), { ...story, turnKind: 'opening' });
  draft.variables = { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result: { commands: [], rejectedSuggestions: [], unresolved: [] } };
  draft.stageStatus.variables = 'ready';
  return { state, draft };
}
const output = (changes = {}) => ({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [], ...changes });

it('多个 pending 只呈现一项，未呈现者不阻断 Story', () => {
  const { state } = setup();
  for (const id of ['one', 'two']) state.events[id] = { ...event(id), status: 'active', estimatedEndAt: later,
    protagonistEntry: { id: `entry-${id}`, sourceTurnId: 'turn-a', queuedAt: state.worldClock, channel: '电话', cue: '来电', status: 'pending' } };
  expect(() => validateStoryEventInteractions(state, { ...story, variableGuide: [{ group: 'event', observedFact: '接听来电', textEvidence: '接听来电', eventInteraction: { eventId: 'one', entryId: 'entry-one', action: 'presented' } }] })).not.toThrow();
});
it('主角离开时留守者只退出现场，地点关系记忆不变', () => {
  const { state } = setup(); state.npc.a.onScene = true;
  state.locations.office = { id: 'office', name: '办公楼' };
  const next = commitCommands(state, 'move', 0, [{ type: 'UpdateProtagonist', protagonistId: 'hero', expectedRevision: 0, commandId: 'move', evidence: '出门', changes: { locationId: 'office' } }]);
  expect(next.npc.a).toEqual({ ...state.npc.a, onScene: false }); expect(state.npc.a.onScene).toBe(true);
});
it('场外 NPC 可以同时拥有 active、blocked、planned 不同任务', () => {
  const { state, draft } = setup();
  const commands = (['active', 'blocked', 'planned'] as const).map((status, i) => ({ type: 'SaveTask', commandId: `task-${i}`, evidence: '不同职责并行', task: { ...task(`task-${i}`), actorRef: { kind: 'npc', id: 'a' }, goal: `职责${i}`, status } }));
  expect(() => parseWorld(JSON.stringify(output({ taskCommands: commands })), state, draft)).not.toThrow();
});
it('活动事件可以新增参与者，仍保留开始时间和稳定ID', () => {
  const { state, draft } = setup();
  const old = { ...event('investigation'), status: 'active' as const, estimatedEndAt: later, actorRefs: [{ kind: 'npc' as const, id: 'a' }] };
  state.events[old.id] = old;
  expect(() => parseWorld(JSON.stringify(output({ eventCommands: [{ type: 'SaveEvent', commandId: 'join', evidence: '共同参与', event: { ...old, actorRefs: [...old.actorRefs, { kind: 'npc', id: 'b' }] } }] })), state, draft)).not.toThrow();
});
it('新的 World 输出不再重复提供 futureEvents 或 timelineCandidates', () => {
  const { state, draft } = setup();
  expect(() => parseWorld(JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] }), state, draft)).not.toThrow();
});
it('没有 WorldEvent 也可记录模糊历史披露，不广播认知或倒退时间', () => {
  const { state } = setup();
  const command = DomainCommandSchema.parse({ type: 'RecordHistory', commandId: 'record', evidence: '本幕披露', entry: { id: 'past', title: '往事', summary: '同事声称在大学时经历一次合作破裂', occurredTimeText: '大学时期', knowledgeKind: 'reported', sourceRef: { kind: 'npc', id: 'a' }, actorRefs: [], relatedEntryIds: [] } });
  const next = commitCommands(state, 'turn-a', 0, [command]);
  expect(next.timeline).toMatchObject([{ id: 'past', recordedAt: state.worldClock, knowledgeKind: 'reported' }]);
  expect(next.npc).toEqual(state.npc); expect(next.worldClock).toBe(state.worldClock);
});

import { history } from './fixtures/historyRecord';
import { projectTurn } from '../domain/turnProjection';
import { GameStateSchema } from '../domain/state';
import type { DomainCommand } from '../domain/commands';
import { playerView } from '../ui/panels/playerView';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';

it.each(['minor','significant','major'] as const)('历史关联%s活动事件，无结案、无公开门槛',impact=>{
 const {state,draft}=setup();state.events.open={...event('open'),impact,status:'active',estimatedEndAt:later,actorRefs:[{kind:'npc',id:'a'}]};
 const result=parseWorld(JSON.stringify(output({worldCommands:[history('open',{knowledgeKind:'reported',summary:'同事称此前参与过此事'})]})),state,draft);
 const after=projectTurn(state,draft,result.worldCommands);
 expect(after.timeline[0]).toMatchObject({eventId:'open',knowledgeKind:'reported'});expect(after.events.open.status).toBe('active');expect(playerView(after).timeline).toHaveLength(1);
});
it.each(['大学时期','三年前','约2005年',undefined])('模糊时间%s保持原义，不补造精确日期',occurredTimeText=>{
 const {state,draft}=setup();const result=parseWorld(JSON.stringify(output({worldCommands:[history('past',{eventId:undefined,occurredTimeText,knowledgeKind:'suspected',sourceText:'没有正式身份的来访者'})]})),state,draft);
 const after=projectTurn(state,draft,result.worldCommands),loaded=GameStateSchema.parse(JSON.parse(JSON.stringify(after)));
 expect(loaded.timeline[0].occurredTimeText).toBe(occurredTimeText);expect(loaded.timeline[0].occurredAt).toBeUndefined();expect(loaded.timeline[0].recordedAt).toBe(state.worldClock);expect(loaded.worldClock).toBe(state.worldClock);
});
it('新披露关联旧条目，文字相同也只按稳定ID去重；精确重放不增加记录',()=>{
 const {state}=setup(),first=history('one',{eventId:undefined,summary:'合作分歧',knowledgeKind:'reported'});
 const initial=commitCommands(state,'first',0,[first]);
 const second=history('two',{eventId:undefined,summary:'合作分歧',knowledgeKind:'suspected',relatedEntryIds:[first.entry.id]});
 const next=commitCommands(initial,'second',initial.revision,[second]);
 expect(next.timeline.map(e=>e.knowledgeKind)).toEqual(['reported','suspected']);expect(commitCommands(next,'second',initial.revision,[second])).toEqual(next);
 expect(()=>commitCommands(next,'third',next.revision,[{...first,commandId:'another'}])).toThrow();expect(initial.timeline).toHaveLength(1);
});
it.each([
 {sourceRef:{kind:'npc',id:'missing'}},{actorRefs:[{kind:'npc',id:'missing'}]},
 {eventId:'missing'},{relatedEntryIds:['missing']},{relatedEntryIds:['history-bad']},
 {locationId:'missing'},{occurredAt:later},{occurredAt:'2026-02-30T08:00:00+08:00'},
 {knowledgeKind:'certain'},{recordedAt:'2000-01-01T00:00:00+08:00'},
 {sourceTurnId:'invented'},{id:'hero'},
])('非法历史结构或引用整批拒绝：%j',changes=>{
 const {state,draft}=setup(),before=structuredClone(state);
 const raw={...history('bad',{eventId:undefined}),entry:{...history('bad',{eventId:undefined}).entry,...changes}};
 expect(()=>parseWorld(JSON.stringify(output({worldCommands:[{type:'CreateLocation',commandId:'place',evidence:'地点',location:{id:'new-place',name:'新地点'}},raw]})),state,draft)).toThrow();expect(state).toEqual(before);
});
it('同批合法新NPC与组织可加入事件，退去旧参与者；历史可引用新人物',()=>{
 const {state,draft}=setup();state.events.open={...event('open'),status:'active',estimatedEndAt:later,actorRefs:[{kind:'npc',id:'a'}]};
 const commands:DomainCommand[]=[{type:'CreateNpc',commandId:'new',evidence:'登场',npc:{...npc('new'),onScene:false,affinity:0}},
 {type:'CreateOrganization',commandId:'org',evidence:'登记',organization:{id:'org',name:'社区协会',kind:'civil',description:'社区组织',protagonistRelation:'未接触',relationHistory:[],keyNpcIds:[],currentTaskIds:[],activities:[]}},
 history('open',{sourceRef:{kind:'npc',id:'new'},actorRefs:[{kind:'organization',id:'org'}]})];
 const result=parseWorld(JSON.stringify(output({worldCommands:commands,eventCommands:[{type:'SaveEvent',commandId:'join',evidence:'参与变化',event:{...state.events.open,actorRefs:[{kind:'npc',id:'new'},{kind:'organization',id:'org'}]}}]})),state,draft);
 const after=projectTurn(state,draft,[...result.worldCommands,...result.eventCommands]);expect(after.events.open.actorRefs.map(a=>a.id)).toEqual(['new','org']);expect(after.events.open.startAt).toBe(state.events.open.startAt);
});
it.each(['invalid-actor','changed-start','hero-move','terminal-rewrite'] as const)('参与变更不放开%s',fault=>{
 const {state,draft}=setup();state.events.open={...event('open'),status:'active',estimatedEndAt:later};
 const updated={...state.events.open};
 if(fault==='invalid-actor')updated.actorRefs=[{kind:'npc',id:'missing'}];
 if(fault==='changed-start')updated.startAt='2026-10-18T07:00:00+08:00';
 if(fault==='terminal-rewrite'){state.events.open.status='resolved';state.events.open.resolvedAt=state.worldClock;state.events.open.resolutionText='结束';}
 const raw=fault==='hero-move'?output({worldCommands:[{type:'UpdateProtagonist',protagonistId:'hero',expectedRevision:0,commandId:'hero-move',evidence:'越权',changes:{locationId:'chongqing'}}]}):output({eventCommands:[{type:'SaveEvent',commandId:'change',evidence:'变化',event:updated}]});
 expect(()=>parseWorld(JSON.stringify(raw),state,draft)).toThrow();
});
it.each([false,true])('主角与同行者更新顺序reverse=%s不影响最终状态，留守者不被移动',reverse=>{
 const {state}=setup();state.npc.a.onScene=true;state.npc.b.onScene=true;state.locations.office={id:'office',name:'办公室'};
 const commands:DomainCommand[]=[{type:'UpdateProtagonist',protagonistId:'hero',commandId:'hero',expectedRevision:0,evidence:'移动',changes:{locationId:'office'}},{type:'UpdateNpc',npcId:'a',commandId:'follow',expectedRevision:0,evidence:'同行',changes:{locationId:'office',onScene:true}}];
 const after=commitCommands(state,'move',0,reverse?commands.reverse():commands);expect(after.npc.a).toMatchObject({onScene:true,locationId:'office'});expect(after.npc.b).toEqual({...state.npc.b,onScene:false});
});
it('纯历史视角可记录旧事供作者理解而不消费当前世界或授予角色知识',()=>{
 const {state,draft}=setup();draft.userInput='切换到同事的视角，回顾他大学时期的生活。';
 draft.story!.variableGuide=[{group:'time',subjectHint:'time:retrospective',observedFact:JSON.stringify({npcId:'a',perspectiveRequest:'切换到同事的视角',pastRequest:'回顾他大学时期的生活',temporalScope:'past_only',currentPlotAdvances:false})}];
 const result=parseWorld(JSON.stringify(output({worldCommands:[history('private-past',{eventId:undefined,summary:'仅此视角记载的旧秘密',sourceRef:{kind:'npc',id:'a'},knowledgeKind:'reported'})]})),state,draft);
 const after=projectTurn(state,draft,result.worldCommands);expect(after.npc).toEqual(state.npc);expect(after.worldClock).toBe(state.worldClock);
 const ctx=contextFor({stage:'story',mode:'regular',state:after,settings:defaultSettings(),userInput:''});expect(JSON.stringify(ctx)).toContain('仅此视角记载的旧秘密');
 expect(contextFor({stage:'world',mode:'regular',state:after,draft:{...draft,baseSaveRevision:after.revision},settings:defaultSettings(),userInput:''}).OFFSCREEN_STATE).toHaveProperty('history',after.timeline);
});
