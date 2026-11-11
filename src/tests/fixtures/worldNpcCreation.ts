import type { DomainCommand } from '../../domain/commands';
import { GameStateSchema } from '../../domain/state';
import { npc, event, task, organizationBase, gameTime } from './game';
import { fullPrivateProfile } from './npcUnified';
import { worldState, worldDraft, worldResult, actionTime } from './world';

/** Synthetic structural replay, deliberately no original names/IDs/narrative. */
export function worldNpcCreation(kind:'ordinary'|'special'='special', gender:'male'|'female'|'unknown'='male', age:number|undefined=42) {
  const state=worldState();state.locations.china={id:'china',name:'中国'};state.locations.chongqing.parentId='china';
  state.locations['overseas-country']={id:'overseas-country',name:'瑞士'};
  const formal=GameStateSchema.parse(state),draft=worldDraft(true,'opening');
  draft.variables!.result.commands=draft.variables!.result.commands.filter(c=>c.type==='SetWorldClock');
  const {longTermMemories: _unused,...source}=kind==='special'?{...npc('remote-relative'),kind:'special' as const,detailedBackground:'长期在外工作，与家庭保持联系。',activeGoals:['处理工作安排'],habits:['核对来信'],longTermMemories:[],offscreenTaskIds:['remote-duty']}:{...npc('remote-relative'),longTermMemories:undefined};void _unused;
  const person={...source,name:'顾延',gender,...(age===undefined?{}:{age}),onScene:false,affinity:0,relationshipText:'主角的亲属，多年来保持家庭联系',locationId:'overseas-city',...(kind==='special'&&gender==='female'&&age!==undefined&&age>=18?{privateProfile:{...fullPrivateProfile}}:{})};
  const create:Extract<DomainCommand,{type:'CreateNpc'}>={type:'CreateNpc',commandId:'create-relative',evidence:'正式背景中的场外亲属',npc:person};
  const result=worldResult([
    {type:'CreateLocation',commandId:'create-city',evidence:'建立真实海外从属地点',location:{id:'overseas-city',name:'苏黎世',parentId:'overseas-country'}},create,
    {type:'RecordNpcMemory',commandId:'remote-memory',npcId:person.id,expectedRevision:0,knowledgeKind:'observed',addToKnownInformation:false,evidence:'本人的经历',memory:{id:'remote-memory',text:'自己在远方收到工作安排并开始核对资料，仍在等待后续消息。',knowledgeKind:'observed',knowledgeSource:'本人经历',visibility:'npc_private',createdAtGameTime:actionTime,sourceTurnIds:[draft.turnId],affectedEntityRefs:[{kind:'npc',id:person.id}]}},
    {type:'CreateOrganization',commandId:'create-company',evidence:'正式背景中的组织',organization:{...organizationBase,id:'remote-company',name:'澄澜商贸',kind:'business',protagonistRelation:'有所耳闻',relationHistory:[],keyNpcIds:[person.id],sectors:['维修供应'],businessRelations:[]}},
  ]);
  result.taskCommands=[{type:'SaveTask',commandId:'remote-task',evidence:'场外人物独立处理工作',task:{...task('remote-duty'),actorRef:{kind:'npc',id:person.id},status:'active',locationId:'overseas-city',dueAt:'2026-10-19T18:00:00+08:00'}}];
  result.eventCommands=[{type:'SaveEvent',commandId:'remote-main',evidence:'远程工作持续发展',event:{...event('remote-main'),eventKind:'main',title:'海外资料核对',status:'active',actorRefs:[{kind:'npc',id:person.id},{kind:'organization',id:'remote-company'}],linkedTaskIds:['remote-duty'],estimatedEndAt:'2026-10-19T18:00:00+08:00',locationId:'overseas-city',sourceTurnIds:[draft.turnId]}},
    {type:'SaveEvent',commandId:'remote-sub',evidence:'后台阶段正在开展，邀请待回应',event:{...event('remote-sub'),eventKind:'sub',parentEventId:'remote-main',title:'远程信息沟通',status:'active',startAt:gameTime,fixedEndAt:'2026-10-18T09:00:00+08:00',estimatedEndAt:undefined,actorRefs:[{kind:'npc',id:person.id}],locationId:'overseas-city',sourceTurnIds:[draft.turnId],continuation:{direction:'protagonist',reason:'等待下一幕由玩家决定是否回复',entry:{channel:'远程消息',cue:'一封资料来信等待回复',locationId:'overseas-city'}}}}];
  return {state:formal,draft,result,create,person};
}
export const worldNpcCommands=(result:ReturnType<typeof worldResult>)=>[...result.worldCommands,...result.taskCommands,...result.eventCommands];

export function worldNpcCreationBatch() {
  const a=worldNpcCreation();
  for(const [id,kind,gender,name] of [['new-ordinary','ordinary','male','顾远'],['new-woman','special','female','周岚']] as const){
    const c=worldNpcCreation(kind,gender,35).create;c.commandId=`create-${id}`;c.npc.id=id;c.npc.identityKey=`identity-${id}`;c.npc.name=name;
    if(c.npc.kind==='special')c.npc.offscreenTaskIds=[];
    a.result.worldCommands.push(c);
  }
  const org=a.result.worldCommands.find(c=>c.type==='CreateOrganization');if(org?.type==='CreateOrganization')org.organization.keyNpcIds=[a.person.id,'new-ordinary','new-woman'];
  return a;
}
