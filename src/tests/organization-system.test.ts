import { expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { organizationState, organizationUpdate, organizationWorld } from './fixtures/organizations';
import { organizations } from './fixtures/game';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';

function draft(state = organizationState()) {
  return rerollStory(createTurnDraft(state.saveId,state.revision,'organization-turn','regular','查看本轮发展'),{
    turnKind:'regular',narrative:'【旁白】社区活动照常推进，既定合作完成确认。',summary:'活动继续',variableGuide:[] });
}
const body = (line:string) => `<thinking>只处理实际变化。</thinking><说明></说明><命令>${line}</命令>`;

it.each(organizations)('$kind创建与对应字段更新：身份稳定，关系历史和无关状态不变', template => {
  const state = organizationState(), id = `new-${template.kind}`;
  const fields = {gang:{internalStatus:'负责人调整后成员稳定'},government:{administrativeAffairs:['处理公开行政事务']},civil:{membershipText:'志愿者队伍稳定'},business:{operatingStatus:'完成业务调整'}};
  const created = commitCommands(state,'create',state.revision,[{type:'CreateOrganization',commandId:'create',evidence:'正式背景',organization:{...template,id,name:'新'+template.kind,protagonistRelation:'闻所未闻'}}]);
  const next = commitCommands(created,'update',created.revision,[organizationUpdate(id,fields[template.kind],created.revision)]);
  expect(next.organizations[id]).toMatchObject({...created.organizations[id],...fields[template.kind]});
  expect(next.npc).toEqual(state.npc); expect(next.economy).toEqual(state.economy);
});

it('管理层无需创建人物；明确关联只使用ID，允许同一个人属于多个组织',()=>{
  const state=organizationState(),before=structuredClone(state.npc);
  const next=commitCommands(state,'management',10,[organizationUpdate('org-government',{leadership:[{position:'负责人',publicName:'已公开姓名'},{position:'保密负责人',publicName:null}],keyNpcIds:['person']})]);
  expect(next.npc).toEqual(before); expect(next.contactNpcIds).toEqual(state.contactNpcIds);
  expect(next.organizations['org-government'].keyNpcIds).toEqual(['person']);expect(next.organizations['org-civil'].keyNpcIds).toEqual(['person']);
  const changed=commitCommands(next,'replace',next.revision,[organizationUpdate('org-government',{leadership:[{position:'负责人',publicName:'继任者'}],keyNpcIds:[]},next.revision)]);
  expect(changed.npc).toEqual(before);expect(changed.organizations['org-government'].leadership).toHaveLength(1);
});

it('稀疏单向关系可建立、替换和结束，旧文字关系与历史不丢失',()=>{
  const state=organizationState();
  const first=commitCommands(state,'relation',10,[organizationUpdate('org-business',{relations:[{organizationId:'org-gang',relation:'竞争',description:'争取同一项目'}]})]);
  expect(first.organizations['org-gang'].relations).toBeUndefined();
  const second=commitCommands(first,'cooperate',first.revision,[organizationUpdate('org-business',{relations:[{organizationId:'org-gang',relation:'合作',description:'共同承担后续维护'}]},first.revision)]);
  expect(second.organizations['org-business'].relations).toHaveLength(1);expect(second.organizations['org-business'].relations![0].relation).toBe('合作');
  const third=commitCommands(second,'end',second.revision,[organizationUpdate('org-business',{relations:[]},second.revision)]);
  expect(third.organizations['org-business'].relations).toEqual([]);expect(third.timeline).toEqual(state.timeline);
  expect(third.organizations['org-business']).toMatchObject({businessRelations:[]});
});

it.each(['npc','organization','self','duplicate-relation','secret-link'] as const)('非法%s引用拒绝，源状态不变',mode=>{
  const state=organizationState(),before=structuredClone(state);
  const changes=mode==='npc'?{keyNpcIds:['no-npc']}:mode==='secret-link'?{leadership:[{position:'幕后',publicName:null,npcId:'person'}]}:
    {relations:Array.from({length:mode==='duplicate-relation'?2:1},()=>({organizationId:mode==='self'?'org-business':mode==='duplicate-relation'?'org-civil':'no-org',relation:'关系',description:'说明'}))};
  expect(()=>commitCommands(state,'bad',10,[organizationUpdate('org-business',changes)])).toThrow();expect(state).toEqual(before);
});

it.each([{funds:100},{id:'other'},{kind:'gang'},{protagonistRelation:'认识'},{relationHistory:[]},{cash:100},{keyNpcIds:['missing']}] )('跨类字段、身份、历史、玩家余额和非法引用不许通过更新入口覆盖：%j',changes=>{
  const state=organizationState();expect(()=>commitCommands(state,'illegal',10,[{...organizationUpdate(),changes}])).toThrow();
});

it('组织金额独立白名单需要依据和合法时间，不影响主角经济',()=>{
  const state=organizationState(),command={...organizationUpdate('org-business',{assetsEstimate:80000000,liquidityEstimate:600000}),financialBasis:{at:state.worldClock,note:'收购结案后的资产和流动资金估计'}};
  expect(()=>commitCommands(state,'no-basis',10,[organizationUpdate('org-business',{assetsEstimate:80000000})])).toThrow();
  const next=commitCommands(state,'estimate',10,[command]);expect(next.organizations['org-business']).toMatchObject(command.changes);expect(next.economy).toEqual(state.economy);
  expect(()=>commitCommands(state,'future',10,[{...command,financialBasis:{...command.financialBasis,at:'2099-01-01T00:00:00+08:00'}}])).toThrow();
  for(const invalid of [-1,1.5,Number.MAX_SAFE_INTEGER+1]) expect(DomainCommandSchema.safeParse({...command,changes:{assetsEstimate:invalid}}).success).toBe(false);
  expect(()=>commitCommands(state,'stale',10,[{...command,expectedRevision:11}])).toThrow(/版本/);
  expect(()=>commitCommands(state,'field',10,[organizationUpdate('org-government',{liquidityEstimate:1})])).toThrow();
});

it('文本协议编译/模拟/World不得重写Variables字段（重复字段以Variables为准并剔除），新可选字段按正式投影校验',async()=>{
  const state=organizationState(),selected=draft(state),before=structuredClone(state);
  const variables=await parseTextVariables(body('set organizations[org-business].state = '+JSON.stringify({operatingStatus:'现场已经确认的新现状',leadership:[{position:'董事长',publicName:'顾行远'}]})),state,selected);
  expect(variables.commands[0]).toMatchObject({type:'UpdateOrganization',expectedRevision:10});
  selected.variables={result:variables,storyRevision:selected.storyRevision,candidateRevision:1,requestRevision:0,validation:'validated'};selected.stageStatus.variables='ready';
  expect(projectTurn(state,selected).organizations['org-business']).toMatchObject({operatingStatus:'现场已经确认的新现状'});
  // #186：World 与 Variables 重复的字段被剔除，不再让整个 World 阶段失败；只剩重复字段的命令整条忽略。
  const dropped=parseWorld(JSON.stringify(organizationWorld([organizationUpdate()])),state,selected);
  expect(dropped.worldCommands).toEqual([]);
  expect(worldNormalizationNotes.get(dropped)?.join('')).toMatch(/operatingStatus.*以变量阶段为准.*整条忽略/);
  const mixed=parseWorld(JSON.stringify(organizationWorld([organizationUpdate('org-business',{operatingStatus:'模型另写的现状',ownershipText:'独立更新的股权说明'})])),state,selected);
  expect(mixed.worldCommands).toEqual([organizationUpdate('org-business',{ownershipText:'独立更新的股权说明'})]);
  expect(projectTurn(state,selected,mixed.worldCommands).organizations['org-business']).toMatchObject({operatingStatus:'现场已经确认的新现状',ownershipText:'独立更新的股权说明'});
  // 提交前重验使用保存下来的剔除结果：不再冲突、不再产生说明，结果不变。
  const again=parseWorld(JSON.stringify(mixed),state,selected);
  expect(again).toEqual(mixed); expect(worldNormalizationNotes.get(again)).toBeUndefined();
  expect(()=>parseWorld(JSON.stringify(organizationWorld([organizationUpdate('org-business',{ownershipText:'独立更新的股权说明'})])),state,selected)).not.toThrow();
  expect(state).toEqual(before);
});

it('#186 Variables新建组织或记录关系后，World重复字段与关系记录被忽略，其余命令照常',()=>{
  const state=organizationState(),selected=draft(state);
  const create={type:'CreateOrganization' as const,commandId:'new-org',evidence:'正文出现的新机构',organization:{...organizations[2],id:'new-civil',name:'江湾读书会',protagonistRelation:'闻所未闻',relationHistory:[]}};
  const relation={type:'RecordOrgRelation' as const,commandId:'rel',evidence:'正文',organizationId:'org-civil',relation:'合作',reason:'主角答应协助'};
  selected.variables={result:{commands:[create,relation],rejectedSuggestions:[],unresolved:[]},storyRevision:selected.storyRevision,candidateRevision:1,requestRevision:0,validation:'validated'};selected.stageStatus.variables='ready';
  const fullName={...organizationUpdate('new-civil',{name:create.organization.name,activities:['周末公开读书活动']}),commandId:'w1'};
  const worldRelation={type:'RecordOrgRelation' as const,commandId:'w2',evidence:'后台',organizationId:'org-civil',relation:'敌对',reason:'模型另写'};
  const createdRelation={...worldRelation,commandId:'w3',organizationId:'new-civil'};
  const independent={...organizationUpdate('org-government',{administrativeAffairs:['处理公开行政事务']}),commandId:'w4'};
  const result=parseWorld(JSON.stringify(organizationWorld([fullName,worldRelation,createdRelation,independent])),state,selected);
  expect(result.worldCommands.map(c=>c.commandId)).toEqual(['w4']);
  const notes=worldNormalizationNotes.get(result)!;
  expect(notes).toHaveLength(3);
  expect(notes[0]).toMatch(/UpdateOrganization（new-civil）.*name、activities.*activities 的值与变量阶段不同.*整条忽略/);
  expect(notes.slice(1).every(note=>note.startsWith('RecordOrgRelation'))).toBe(true);
});

it('#186 剔除金额字段后不保留孤立的财务依据',()=>{
  const state=organizationState(),selected=draft(state);
  const prior={...organizationUpdate('org-business',{assetsEstimate:80000000}),financialBasis:{at:state.worldClock,note:'正文确认'}};
  selected.variables={result:{commands:[prior],rejectedSuggestions:[],unresolved:[]},storyRevision:selected.storyRevision,candidateRevision:1,requestRevision:0,validation:'validated'};selected.stageStatus.variables='ready';
  const world={...organizationUpdate('org-business',{assetsEstimate:90000000,ownershipText:'股权不变'}),commandId:'w',financialBasis:{at:state.worldClock,note:'模型估计'}};
  const result=parseWorld(JSON.stringify(organizationWorld([world])),state,selected);
  expect(result.worldCommands).toEqual([{...organizationUpdate('org-business',{ownershipText:'股权不变'}),commandId:'w'}]);
});

it('无变化回合可不更新，World支持同批创建后更新；重复命令幂等，不允许同类重名',()=>{
  const state=organizationState();expect(parseWorld(JSON.stringify(organizationWorld()),state,draft()).worldCommands).toEqual([]);
  const create={type:'CreateOrganization' as const,commandId:'new-org',evidence:'后台正式机构',organization:{...organizations[2],id:'new-civil',name:'江湾读书会',protagonistRelation:'闻所未闻',relationHistory:[]}};
  const command=organizationUpdate('new-civil',{activities:['公开读书活动']});
  expect(()=>parseWorld(JSON.stringify(organizationWorld([create,command])),state,draft())).not.toThrow();
  const repeated={...organizationUpdate(),commandId:'once'},once=commitCommands(state,'once',10,[repeated]);
  expect(commitCommands(once,'once',10,[repeated])).toEqual(once);
  expect(()=>commitCommands(state,'name',10,[{...create,organization:{...create.organization,name:state.organizations['org-civil'].name}}])).toThrow();
});
