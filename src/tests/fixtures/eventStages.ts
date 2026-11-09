import { worldState, worldResult } from './world';
import { event } from './game';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
import { GameStateSchema } from '../../domain/state';
import type { WorldEvent } from '../../domain/events/schema';
import type { DomainCommand } from '../../domain/commands';
export const stageStart='2027-01-01T00:00:00+08:00', stageNow='2027-04-01T00:00:00+08:00';
export function mainStage():WorldEvent {return {...event('main-stage'),eventKind:'main',title:'联合资料整理',startAt:stageStart,
  estimatedEndAt:'2027-02-01T00:00:00+08:00',actorRefs:[{kind:'organization',id:'org-stage-a'}],sourceTurnIds:[]};}
export function subStage(id='stage-one',start=stageStart,end='2027-01-03T00:00:00+08:00'):WorldEvent {
  const {estimatedEndAt:_end,...e}=mainStage();void _end;
  return {...e,id,title:id,eventKind:'sub',parentEventId:'main-stage',status:'active',startAt:start,fixedEndAt:end,
    prerequisites:['按现实情况开展工作'],blockers:['部分资料仍未找到']};
}
export function stageCommand(event:WorldEvent):Extract<DomainCommand,{type:'SaveEvent'}> {return {type:'SaveEvent',commandId:`write:${event.id}`,event,evidence:'合成阶段候选，结果由模型决定'};}
export function endStage(e:WorldEvent,outcome:'success'|'failure'|'changed'|'cancelled'='success'):WorldEvent {
  return {...e,status:outcome==='cancelled'?'cancelled':'resolved',resolvedAt:e.fixedEndAt,outcome,
    resolutionText:'本阶段完成资料核对，存在的问题留待后续处理。',
    resultKnowledge:{facts:['本阶段结束'],reported:['值班人员提出另一种说法'],suspected:['可能仍有遗漏']},
    sourceTurnIds:[...e.sourceTurnIds.filter(id=>id!=='stage-current'),'stage-current'],continuation:{direction:'end',reason:'按真实需要再决定是否承接'}};
}
export function stageContext(now=stageNow) {
  const state=worldState();state.worldClock=stageStart;
  for(const id of ['org-stage-a','org-stage-b'])state.organizations[id]={id,name:id,kind:'business',description:'合成资料部门',protagonistRelation:'无',relationHistory:[],keyNpcIds:[],currentTaskIds:[],sectors:[],businessRelations:[]};
  state.events={'main-stage':mainStage(),'stage-one':subStage()};
  const story=rerollStory(createTurnDraft('save-a',0,'stage-current','opening',''),{turnKind:'opening',narrative:'【旁白】日常工作与生活继续。',summary:'生活继续。',variableGuide:[]});
  const draft=TurnDraftSchema.parse({...story,variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{commands:[{type:'SetWorldClock',commandId:'stage-clock',worldClock:now,evidence:'所选正文时间'}],rejectedSuggestions:[],unresolved:[]}},stageStatus:{...story.stageStatus,variables:'ready'}});
  return {state:GameStateSchema.parse(state),draft,response:worldResult()};
}
