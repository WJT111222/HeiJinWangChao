import { expect,it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { composePrompt } from '../prompts/composer';
import { contextStatistics, characterCount } from '../prompts/statistics';
import { inspectBudget } from '../prompts/budgetInspection';
import { npcContextFixture } from './fixtures/npcContextTiers';
it('10/30/60合成人物：真实最终messages、人物体量、分类与重复可复现测量',async()=>{
 const rows=[];
 for(const count of [10,30,60]){
  const a=npcContextFixture(count),before=structuredClone(a);
  for(const stage of ['story','variables','world'] as const){
   const started=performance.now(),prompt=await composePrompt({...a,stage,mode:'regular',userInput:a.draft.userInput});
   const buildMilliseconds=performance.now()-started,analysisStarted=performance.now(),statistics=contextStatistics(prompt.messages),budget=inspectBudget(prompt.messages);
   const data=prompt.context,save=data.SAVE_STATE as {npc:Record<string,unknown>;memories:{npcSummaries:unknown}};
   const npcCharacters=characterCount(JSON.stringify([save.npc,save.memories.npcSummaries,data.NPC_KNOWLEDGE,data.SCENE_NPCS??data.SCENE_NPC_IDS,(data.OFFSCREEN_STATE as {npc?:unknown;npcIds?:unknown}|undefined)?.npc??(data.OFFSCREEN_STATE as {npcIds?:unknown}|undefined)?.npcIds,data.NPC_CONTEXT]));
   const groups={sceneOrdinary:0,sceneSpecial:0,offsceneOrdinary:0,offsceneSpecial:0};
   for(const person of Object.values(save.npc) as {kind:string;onScene:boolean}[]){const key=person.onScene?(person.kind==='special'?'sceneSpecial':'sceneOrdinary'):(person.kind==='special'?'offsceneSpecial':'offsceneOrdinary');groups[key]++;}
   rows.push({count,stage,groups,npcDuplicateFamilies:budget.duplicates.filter(d=>d.identity.startsWith('npc:')||d.identity.startsWith('memory:')&&!d.identity.startsWith('memory:layered:')).length,repeatedRepresentation:budget.repeatedRepresentation,characters:statistics.characters,estimatedTokens:statistics.estimatedTokens,npcCharacters,npcCategoryCharacters:budget.categories.filter(c=>c.id==='npc'||c.id==='npcMemory').reduce((sum,c)=>sum+c.characters,0),buildMilliseconds:Math.round(buildMilliseconds*100)/100,inspectionMilliseconds:Math.round((performance.now()-analysisStarted)*100)/100,duplicates:budget.duplicates});
   expect(statistics.characters).toBeGreaterThan(0);
  }
  expect(a).toEqual(before);
 }
 if(process.env.NPC_CONTEXT_METRICS)writeFileSync(process.env.NPC_CONTEXT_METRICS,JSON.stringify(rows,null,2));
},30000);
