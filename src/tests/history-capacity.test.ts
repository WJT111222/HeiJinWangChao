import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GameStateSchema } from '../domain/state';
import { historyProjection, historyPageSize } from '../domain/history/projection';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { defaultSettings } from '../ui/settings/model';
import { undoPolicy } from '../services/storage/turnUndo';
import { worldState, worldDraft } from './fixtures/world';
import { chronicle, historyEntry } from './fixtures/historyV2';

it('可重复合成规模：完整状态/五份快照/三阶段实际上下文；分页不减少存储或Token',async()=>{
 const rows=[];
 const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
 for(const count of [0,100,1000,5000]) {
  const state=worldState();
  state.timeline=Array.from({length:count},(_,i)=>{
   const c=chronicle(`milestone-${i}`,{precision:'day',date:`${1900+Math.floor(i/336)}-${String(1+Math.floor(i/28)%12).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`});
   c.narrative='地方文化设施陆续修建，志愿者组织募书与整理工作。正式开放后，管理团队持续开展公共服务并记录运行情况。'.repeat(8);
   if(i)c.relations=[{kind:'follows',entryId:`history-${i-1}`}];
   return historyEntry(`history-${i}`,c);
  });
  const start=performance.now();const checked=GameStateSchema.parse(state),validateMs=performance.now()-start;
  const sortStart=performance.now();const projected=historyProjection(checked.timeline),sortMs=performance.now()-sortStart;
  expect(projected.slots).toHaveLength(count);expect(projected.slots.slice(0,historyPageSize).length).toBe(Math.min(count,historyPageSize));
  const snapshot={version:1,saveId:state.saveId,turnId:'next-turn',beforeTurnId:'turn-a',input:'继续',stateJSON:JSON.stringify(state)};
  const oneSnapshot=bytes(snapshot),stages=[];
  for(const stage of ['story','variables','world'] as const){
   const composeStart=performance.now();const prompt=await composePrompt({stage,state:checked,draft:worldDraft(),mode:'regular',settings:defaultSettings(),userInput:'继续'});
   const composeMs=performance.now()-composeStart,stats=contextStatistics(prompt.messages);
   stages.push({stage,characters:stats.characters,contentBytes:stats.contentBytes,estimatedTokens:stats.estimatedTokens,composeMs});
   if(count)expect(prompt.messages.some(m=>m.content.includes(`history-${count-1}`))).toBe(true);
  }
  rows.push({count,narrativeCharacters:state.timeline[0]?.chronicle?.narrative.length??0,stateBytes:bytes(state),timelineBytes:bytes(state.timeline),snapshotBytes:oneSnapshot,
   fiveSnapshotBytes:5*oneSnapshot,maxEquivalentSnapshots:Math.min(5,Math.floor(undoPolicy.maxBytes/oneSnapshot)),validateMs,sortMs,stages});
  expect(state.timeline).toHaveLength(count);
 }
 if(process.env.HISTORY_MEASUREMENTS)writeFileSync(process.env.HISTORY_MEASUREMENTS,JSON.stringify({node:process.version,kind:'synthetic',storageUnit:'JSON UTF-8 bytes; not physical IndexedDB allocation',rows},null,2));
 expect(rows[3].stateBytes).toBeGreaterThan(rows[2].stateBytes);expect(rows[3].stages[2].characters).toBeGreaterThan(rows[3].stateBytes/3);
},120000);
