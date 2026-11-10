import { GameStateSchema } from '../../domain/state';
import { NpcMemoryBatchSchema, npcSummaryInput, parseNpcSummary } from '../../domain/memories/npcMemory';
import { contextV2Fixture } from './contextV2';
import { npc } from './game';
import { fullPrivateProfile } from './npcUnified';

/** Synthetic four-tier world, no real player data. */
export function npcContextFixture(count=10) {
 const a=contextV2Fixture();
 for(let i=Object.keys(a.state.npc).length;i<count;i++){
  const id=`tier-npc-${i}`,kind=i%2?'special':'ordinary',onScene=i%4<2;
  a.state.npc[id]=kind==='special'?{...npc(id),kind,onScene,detailedBackground:`完整成长经历${i}`,activeGoals:['经营工作室'],habits:['整理工作日志'],longTermMemories:[],offscreenTaskIds:[],age:30,gender:'female',privateProfile:{...fullPrivateProfile}}:{...npc(id),onScene};
 }
 a.state.journal=Array.from({length:40},(_,i)=>({turnId:`tier-turn-${i}`,revision:i+1,relatedActorRefs:[{kind:'protagonist' as const,id:a.state.protagonist.id}],story:{turnKind:'regular' as const,narrative:`合成第${i}回合：日常工作与环境观察。`,summary:`合成日常${i}`,variableGuide:[]}}));
 a.state.revision=a.state.turnNumber=40;a.draft.baseSaveRevision=40;
 a.state.memories.npcSummaries={};
 Object.values(a.state.npc).forEach((person,index)=>{
  person.background=`人物${index}完整基础背景：`+'成长、求学、工作与家庭经历。'.repeat(30);
  person.appearance=`人物${index}外貌：`+'衣着整洁。'.repeat(10);person.temperament='独立、谨慎，愿意沟通';
  person.phoneContact={status:'unknown'};person.usualLocations=[{locationId:'chongqing',role:'home',knownToProtagonist:false}];
  person.memories=Array.from({length:40},(_,i)=>({id:`${person.id}-raw-${i}`,text:`人物${index}原始经历${i}：`+'这次经历保留了人物当时的感受和明确约定。'.repeat(8),knowledgeKind:'observed' as const,knowledgeSource:'本人亲历',visibility:'npc_private' as const,sourceTurnIds:[`tier-turn-${i}`],affectedEntityRefs:[{kind:'npc' as const,id:person.id}],createdAtGameTime:a.state.worldClock}));
  person.knownInformation=[{text:`人物${index}已知的工作安排`,source:'当面确认',learnedAt:a.state.worldClock}];
  if(person.kind==='special'){person.longTermMemories=[];person.detailedBackground=`专属人生${index}：`+'经历与个人目标。'.repeat(30);}
  for(let batch=0;batch<2;batch++){
   const input=NpcMemoryBatchSchema.parse({saveId:a.state.saveId,saveCreatedAt:a.state.createdAt,npcId:person.id,identityKey:person.identityKey,expectedCount:15,entries:person.memories.slice(batch*15,batch*15+15)});
   const result=parseNpcSummary(JSON.stringify({summaries:npcSummaryInput(input).groups.map(g=>({groupId:g.groupId,text:`人物${index}第${batch}组既有经历总结。`})),unresolved:[],contradictions:[]}),input,`${person.id}-summary-${batch}`);
   a.state.memories.npcSummaries[person.id]=[...(a.state.memories.npcSummaries[person.id]??[]),...result];
  }
 });
 a.state=GameStateSchema.parse(a.state);a.draft.variables!.result.commands=[];
 a.draft.userInput='继续当前交流。';a.draft.story!.narrative='【旁白】主角继续当前交流。';a.draft.story!.variableGuide=[];
 return a;
}
