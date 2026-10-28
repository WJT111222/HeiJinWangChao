import { describe, expect, it } from 'vitest';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import type { ExecutionResult } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story, organizations } from './fixtures/game';

function unwrap<T>(r: ExecutionResult<T>): T { if (!r.ok) throw new Error(r.error.code); return r.value; }
const set = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
const push = (path: string, value: unknown) => `push ${path} = ${JSON.stringify(value)}`;
function ordinary() { const { id: _id, ...value } = npc('new-person'); void _id; return value; }
function special() { return { ...ordinary(), kind:'special', detailedBackground:'在社区工作多年', activeGoals:[], habits:[], longTermMemories:[], offscreenTaskIds:[] }; }
const memory = {text:'约定周末去书店', knowledgeKind:'observed', knowledgeSource:'当面谈话', visibility:'npc_private'};
async function execute(body: string) {
  const state = game(); state.turnNumber=1; state.journal=[{turnId:'past',revision:0,story,relatedActorRefs:[]}];
  const draft = rerollStory(createTurnDraft(state.saveId,state.revision,'text-turn','regular','继续'),story);
  const context={draft,expectedRevision:state.revision};
  const parsed=parseVariableText(`<说明>只记录当前变化</说明><命令>\n${body}\n</命令>`);
  if (!parsed.ok) throw new Error(parsed.error.code);
  const before=structuredClone(state), plan=unwrap(await compileVariableCommands(parsed.value,state,context));
  const after=unwrap(await simulateVariablePlan(plan,state,context));
  expect(state).toEqual(before);
  return {state,context,plan,after,ast:parsed.value};
}
describe('正式文本能力缺口复现',()=>{
  it('普通回合可首次建立普通NPC并在同批更新',async()=>{
    const r=await execute([set('npc[new-person]',ordinary()),set('npc[new-person].healthText','手掌轻伤'),push('npc[new-person].memories',memory)].join('\n'));
    expect(r.after.npc['new-person']).toMatchObject({healthText:'手掌轻伤',memories:[expect.objectContaining({text:memory.text})]});
  });
  it('同批建立特殊NPC并维护目标、长期记忆和知晓信息',async()=>{
    const r=await execute([set('npc[new-person]',special()),set('npc[new-person].activeGoals',['参加资格考试']),push('npc[new-person].longTermMemories',memory),push('npc[new-person].knownInformation',{...memory,text:'听说周末下雨',knowledgeKind:'reported'})].join('\n'));
    expect(r.after.npc['new-person']).toMatchObject({kind:'special',activeGoals:['参加资格考试'],longTermMemories:[expect.objectContaining({text:memory.text})],knownInformation:[expect.objectContaining({text:'[转述]听说周末下雨'})]});
  });
  it('结构化好感和联系人可在同批建档后记录',async()=>{
    const r=await execute([set('npc[new-person]',ordinary()),set('npc[new-person].affinityChange',{from:30,to:35,reason:'互相帮助',relationshipText:'愿意互相帮助'}),set('npc[new-person].contact',{reason:'交换联系方式'})].join('\n'));
    expect(r.after.npc['new-person']).toMatchObject({affinity:35,affinityConfirmed:true,relationshipText:'愿意互相帮助'});
    expect(r.after.contactNpcIds).toEqual(['new-person']);
  });
  it.each(organizations)('$kind 组织可创建后记录关系',async(org)=>{
    const {id:_id,...value}=org;void _id;
    const r=await execute([set('organizations[new-org]',value),set('organizations[new-org].protagonistRelation',{relation:'协作中',reason:'完成沟通'})].join('\n'));
    expect(r.after.organizations['new-org']).toMatchObject({kind:org.kind,protagonistRelation:'协作中',relationHistory:[...org.relationHistory,'完成沟通']});
  });
});

describe('实体映射的执行与安全回归',()=>{
  it('同批连续好感变化依次检查真实前值，精确重放不重复记录',async()=>{
    const r=await execute([set('npc[new-person]',ordinary()),set('npc[new-person].affinityChange',{from:30,to:35,reason:'协作',relationshipText:'愿意协作'}),set('npc[new-person].affinityChange',{from:35,to:40,reason:'达成共识',relationshipText:'达成共识'}),set('npc[new-person].contact',{reason:'交换联系方式'}),push('npc[new-person].memories',memory)].join('\n'));
    expect(r.after.npc['new-person'].affinity).toBe(40);
    const replay=unwrap(await compileVariableCommands(r.ast,r.after,r.context));
    expect(replay.commands).toEqual(r.plan.commands);
    expect(unwrap(await simulateVariablePlan(replay,r.after,r.context))).toEqual(r.after);
  });
  it('新人物可参与同批物品赠送及组织引用，不要求初始存档中存在',async()=>{
    const {id:_id,...org}=organizations[3];void _id;
    const r=await execute([set('npc[new-person]',ordinary()),set('items[phone]',{name:'手机',category:'device',quantity:1,conditionText:'完好',ownerRef:{kind:'npc',id:'new-person'}}),set('organizations[office]',{...org,keyNpcIds:['new-person']})].join('\n'));
    expect(r.after.items.phone.ownerRef).toEqual({kind:'npc',id:'new-person'});
    expect(r.after.organizations.office.keyNpcIds).toEqual(['new-person']);
  });
  it('记忆只写指定NPC，认知类型和私有可见性保持独立',async()=>{
    const second={...ordinary(),name:'另一位同事',identityKey:'second-person'};
    const r=await execute([set('npc[new-person]',special()),set('npc[second]',second),push('npc[new-person].longTermMemories',{...memory,knowledgeKind:'suspected'})].join('\n'));
    expect(r.after.npc.second.memories).toEqual([]);
    expect(r.after.memories.short).toEqual([]);
    expect(r.after.npc['new-person']).toMatchObject({longTermMemories:[expect.objectContaining({text:'[推测]'+memory.text,visibility:'npc_private',sourceTurnIds:['text-turn']})]});
  });
  const bad=[
    set('npc[new-person]',{...ordinary(),id:'override'}),set('npc[new-person]',{...ordinary(),unknown:1}),
    set('npc[new-person]',{...ordinary(),affinity:101}),set('npc[new-person]',{...ordinary(),locationId:'missing'}),
    set('npc[new-person]',{...ordinary(),kind:'special'}),set('npc[new-person]',ordinary())+'\n'+set('npc[new-person]',ordinary()),
    set('npc[new-person]',ordinary())+'\n'+set('npc[duplicate]',ordinary()),
    set('npc[new-person]',ordinary())+'\n'+set('npc[new-person].activeGoals',['不适用于普通人物']),
    set('npc[new-person]',ordinary())+'\n'+push('npc[new-person].longTermMemories',memory),
    set('npc[new-person]',ordinary())+'\n'+set('npc[new-person].affinityChange',{from:0,to:35,reason:'协作',relationshipText:'愿意协作'}),
    set('npc[new-person]',ordinary())+'\n'+set('npc[new-person].affinityChange',{from:30,to:101,reason:'协作',relationshipText:'愿意协作'}),
    set('npc[new-person]',ordinary())+'\n'+set('npc[new-person].affinityChange',{from:30,to:35,reason:'协作'}),
    set('npc[new-person].contact',{reason:'无此实体'}),set('npc[new-person].healthText','更新在创建之前')+'\n'+set('npc[new-person]',ordinary()),
    set('npc[new-person]',ordinary())+'\n'+set('npc[new-person].contact',{reason:'联系',npcId:'other'}),
    set('npc[new-person].habits',[]),set('npc[new-person].identity','自由更新'),set('npc[new-person].affinity',50),
    set('organizations[office]',{...organizations[3]}),set('organizations[office]',{kind:'business',name:'缺失字段'}),
    set('organizations[office].protagonistRelation',{relation:'新关系',reason:'无实体'}),set('organizations[office].funds',100),
    set('economy.cash',10000),set('economy.properties[home]',{}),set('tasks[background]',{}),set('events[background]',{}),
  ];
  it.each(bad)('错误字段或真实数据约束整批失败，不返回部分状态：%s',async(body)=>{
    const state=game();state.turnNumber=1;state.journal=[{turnId:'old',revision:0,story,relatedActorRefs:[]}];
    const draft=rerollStory(createTurnDraft(state.saveId,0,'text-turn','regular','继续'),story),context={draft,expectedRevision:0};
    const parsed=parseVariableText(`<命令>\nset protagonist.emotionText = "新情绪"\n${body}\n</命令>`);
    if(!parsed.ok)throw new Error('样例必须能通过语法解析');
    const before=structuredClone({state,context}),plan=await compileVariableCommands(parsed.value,state,context);
    const result=plan.ok?await simulateVariablePlan(plan.value,state,context):plan;
    expect(result.ok).toBe(false);expect(result).not.toHaveProperty('value');expect({state,context}).toEqual(before);
  });
  it.each(['story','revision'] as const)('新实体计划不能跨%s变化应用',async(kind)=>{
    const r=await execute(set('npc[new-person]',ordinary()));
    if(kind==='revision')r.state.revision++;
    else r.context.draft=rerollStory(r.context.draft,{...story,narrative:'重新选定的正文'});
    expect((await simulateVariablePlan(r.plan,r.state,r.context)).ok).toBe(false);
    expect(r.state.npc['new-person']).toBeUndefined();
  });
  it('扩展命令仍可经原JSON变量入口解析，不改正式协议',async()=>{
    const {parseVariables}=await import('../services/validation/aiOutputs');
    const r=await execute([set('npc[new-person]',special()),push('npc[new-person].longTermMemories',memory)].join('\n'));
    expect(parseVariables(JSON.stringify({commands:r.plan.commands,rejectedSuggestions:[],unresolved:[]}),r.state,r.context.draft).commands).toEqual(r.plan.commands);
  });
});

describe('开局初始化和跨变量组整批执行',()=>{
  it('待定开局只注入一次Story时钟，同时创建NPC/组织/物品并更新同伴',async()=>{
    const state=game();state.openingTimePending=true;state.worldClock='0001-01-01T00:00:00+08:00';
    state.npc.companion={...npc('companion'),name:'初始同伴',affinity:0,kind:'special',detailedBackground:'创角资料',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[]};
    state.initialCompanionId='companion';
    const endAt='2015-07-08T08:05:00+08:00';
    const draft=rerollStory(createTurnDraft(state.saveId,0,'opening','opening',''),{...story,turnKind:'opening',variableGuide:[{group:'time',subjectHint:'time:opening',observedFact:JSON.stringify({startAt:'2015-07-08T08:00:00+08:00',endAt})}]});
    const {id:_id,...org}=organizations[3];void _id;
    const parsed=parseVariableText(`<命令>\n${[
      set('npc[new-person]',ordinary()),set('npc[new-person].relationshipText','初次交流后愿意帮忙'),
      set('npc[companion].affinityChange',{from:null,to:10,reason:'开局互助',relationshipText:'彼此支持'}),
      set('organizations[office]',{...org,keyNpcIds:['new-person']}),
      set('items[note]',{name:'便条',category:'document',quantity:1,conditionText:'完好',ownerRef:{kind:'npc',id:'new-person'}}),
      push('npc[new-person].knownInformation',memory),
    ].join('\n')}\n</命令>`);
    if(!parsed.ok)throw new Error(parsed.error.code);
    const context={draft,expectedRevision:0},before=structuredClone(state),plan=unwrap(await compileVariableCommands(parsed.value,state,context));
    expect(plan.commands.filter(c=>c.type==='SetWorldClock')).toHaveLength(1);
    const after=unwrap(await simulateVariablePlan(plan,state,context));
    expect(after.worldClock).toBe(endAt);expect(after.npc.companion.affinity).toBe(10);
    expect(after.npc['new-person'].memories[0].createdAtGameTime).toBe(endAt);
    const replay=unwrap(await compileVariableCommands(parsed.value,after,context));
    expect(unwrap(await simulateVariablePlan(replay,after,context))).toEqual(after);expect(state).toEqual(before);
  });
  it('原同伴身份键和别名不能换ID重建，新身份不污染已有联系人',async()=>{
    const state=game();state.turnNumber=1;state.journal=[{turnId:'past',revision:0,story,relatedActorRefs:[]}];
    state.npc.companion={...npc('companion'),kind:'special',detailedBackground:'',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[]};state.initialCompanionId='companion';
    for(const value of [{...ordinary(),identityKey:state.npc.companion.identityKey},{...ordinary(),name:state.npc.companion.name}]){
      const parsed=parseVariableText(`<命令>\n${set('npc[copy]',value)}\n</命令>`);if(!parsed.ok)throw new Error(parsed.error.code);
      const context={draft:rerollStory(createTurnDraft(state.saveId,0,'turn','regular',''),story),expectedRevision:0};
      const plan=unwrap(await compileVariableCommands(parsed.value,state,context));
      expect((await simulateVariablePlan(plan,state,context)).ok).toBe(false);expect(state.npc.copy).toBeUndefined();
    }
  });
});
