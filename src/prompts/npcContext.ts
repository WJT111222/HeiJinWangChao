import type { GameState } from '../domain/state';
import { rawNpcMemories, validNpcSummary, npcMemoryPolicy } from '../domain/memories/npcMemory';
import type { RecallCues } from '../domain/memories/recall';

export const npcContextPolicy = 'SAVE_STATE.npc是唯一人物资料表，NPC_CONTEXT.groups仅列稳定ID。分类只依据当前kind/onScene，不授予命令权限。现场普通与全部活动特殊档案完整提供；离场普通省略无关长背景，明确提及或承担活动职责时展开。记忆及知晓按本人归属，原文只在npc.memories、总结只在SAVE_STATE.memories.npcSummaries；可靠总结可覆盖离场普通的旧原文，近期/相关/未总结原文保留。没有可靠总结不编造替代摘要。作者可读背景不等于主角/NPC已知，unknown电话与knownToProtagonist=false地址不自动成为主角线索。';

/** Read-only projection. No entity limit, state write, semantic approval or AI call. */
export function npcContext(state: GameState, cues: RecallCues, sourceTurns: ReadonlySet<string>) {
 const groups={sceneOrdinary:[] as string[],sceneSpecial:[] as string[],offsceneOrdinary:[] as string[],offsceneSpecial:[] as string[]};
 const projected:Record<string,unknown>={},summaries:GameState['memories']['npcSummaries']={},selection:Record<string,unknown>={};
 const query=[cues.playerInput,cues.storyText,...(Array.isArray(cues.variableGuide)?cues.variableGuide:[]).map(g=>typeof g?.subjectHint==='string'?g.subjectHint:'')].filter(Boolean).join('\n');
 for(const person of Object.values(state.npc)){
  const tier=person.onScene?(person.kind==='special'?'sceneSpecial':'sceneOrdinary'):(person.kind==='special'?'offsceneSpecial':'offsceneOrdinary');
  groups[tier].push(person.id);
  const taskIds=Object.values(state.tasks).filter(t=>t.actorRef.kind==='npc'&&t.actorRef.id===person.id&&!['completed','cancelled'].includes(t.status)).map(t=>t.id);
  const eventIds=Object.values(state.events).filter(e=>!['resolved','cancelled'].includes(e.status)&&(e.actorRefs.some(a=>a.kind==='npc'&&a.id===person.id)||e.linkedTaskIds.some(id=>taskIds.includes(id)))).map(e=>e.id);
  // Conservative read enrichment only: overlapping names may expand both records,
  // never bind an identity or authorize either actor's commands.
  const referenced=[person.id,person.name,...person.aliases].some(name=>query.includes(name));
  const duty=Object.values(state.organizations).some(org=>org.keyNpcIds.includes(person.id));
  const expanded=person.onScene||person.kind==='special'||referenced||taskIds.length>0||eventIds.length>0||duty;
  const allRaw=rawNpcMemories(person),allSummaries=state.memories.npcSummaries[person.id]??[];
  const fullMemory=expanded||allRaw.length<=npcMemoryPolicy.contextRawLimit;
  const covered=new Set(fullMemory?[]:allSummaries.filter(s=>validNpcSummary(state,person.id,s)).flatMap(s=>s.npcProvenance!.sourceMemoryIds));
  const recent=new Set(fullMemory?[]:[...allRaw].map((memory,index)=>({memory,index})).sort((a,b)=>Date.parse(b.memory.createdAtGameTime)-Date.parse(a.memory.createdAtGameTime)||b.index-a.index).slice(0,npcMemoryPolicy.contextRawLimit).map(({memory})=>memory.id));
  const selected=fullMemory?allRaw:allRaw.filter(m=>!covered.has(m.id)||recent.has(m.id)||m.sourceTurnIds.some(id=>sourceTurns.has(id)));
  const {longTermMemories: legacy,...full}=person.kind==='special'?person:{...person,longTermMemories:undefined};
  void legacy;
  const active:Record<string,unknown>={...full};
  const {appearance,temperament,background,...compact}=active;
  projected[person.id]={...(expanded?active:compact),memories:selected};
  if(Object.hasOwn(state.memories.npcSummaries,person.id))summaries[person.id]=allSummaries;
  selection[person.id]={tier,expanded,referenced,organizationDuty:duty,taskIds,eventIds,rawCount:allRaw.length,selectedRawCount:selected.length,
   summaryCount:allSummaries.length,omittedCoveredRawCount:allRaw.length-selected.length,
   ...(expanded?{}:{omittedFields:[...(['appearance','temperament','background'] as const)].filter(k=>person[k]!==undefined)})};
  void appearance;void temperament;void background;
 }
 return {npc:projected,npcSummaries:summaries,index:{groups,selection,policy:npcContextPolicy}};
}
