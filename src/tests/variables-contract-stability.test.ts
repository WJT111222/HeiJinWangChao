import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { game, npc, event, story } from './fixtures/game';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { SaveRepository } from '../services/storage/saveRepository';
import { completeDraft, submission } from './fixtures/turn';
import { projectTurn } from '../domain/turnProjection';
const time='2026-10-18T08:05:00+08:00';
const body=`set protagonist.emotionText = "逐渐平静"
set npc[friend].healthText = "稍感疲倦"
set npc[friend].affinityChange = {"from":30,"to":32,"reason":"双方解释误会","relationshipText":"愿意继续沟通"}
set npc[friend].lastInteractionAt = "${time}"
push npc[friend].memories = {"text":"自己听取对方解释并回应，误会有所缓和，但远方的问题仍待处理。","knowledgeKind":"observed","knowledgeSource":"本轮交谈","visibility":"npc_private"}
set worldClock = "${time}"`;
const envelope=(s:string)=>`<thinking>落实实际变化。</thinking><说明>只写本幕变化。</说明><命令>\n${s}\n</命令>`;
function fixture() {
 const state=game();state.turnNumber=1;state.journal=[{turnId:'prior',revision:0,story,relatedActorRefs:[]}];
 state.npc.friend=npc('friend');state.npc.remote={...npc('remote'),onScene:false};
 state.events.remoteEvent={...event('remoteEvent'),status:'active',estimatedEndAt:'2026-10-19T18:00:00+08:00',actorRefs:[{kind:'npc',id:'remote'}],sourceTurnIds:['prior']};
 const initial=createTurnDraft(state.saveId,state.revision,'current','regular','解释误会');
 const draft=rerollStory(initial,{...story,narrative:'两人在咖啡店交谈，讨论远方尚未解决的问题。'});
 GameStateSchema.parse(state);return {state,initial,draft};
}
it('无事件变化仍完整写入关系和记忆，时钟先应用；正式事件原样保留',async()=>{
 const a=fixture(),before=structuredClone(a.state),result=await parseTextVariables(envelope(body),a.state,a.draft);
 expect(result.commands.some(c=>c.type==='SaveEvent')).toBe(false);
 const next=projectTurn(a.state,a.draft,result.commands);
 expect(next.events).toEqual(before.events);expect(next.npc.friend).toMatchObject({affinity:32,lastInteractionAt:time,healthText:'稍感疲倦'});
 expect(next.npc.friend.memories[0]).toMatchObject({createdAtGameTime:time,sourceTurnIds:['current'],affectedEntityRefs:[{kind:'npc',id:'friend'}]});expect(a.state).toEqual(before);
});
it.each(['none','mention','enter'] as const)('后台active重复写入的权限与精准位置：%s',async mode=>{
 const a=fixture(),before=structuredClone(a.state);
 if(mode!=='none')a.draft.story!.variableGuide=[{group:'event',observedFact:'本轮接触',eventNarration:{eventId:'remoteEvent',mode,at:time}}];
 const run=parseTextVariables(envelope(body+'\nset events[remoteEvent].sceneState = {"status":"active"}'),a.state,a.draft);
 if(mode==='enter')expect((await run).commands.some(c=>c.type==='SaveEvent')).toBe(true);
 else {
  await expect(run).rejects.toMatchObject({details:{domainRule:'scene_event_permission',commandIndex:6,valuePath:'events[id].sceneState',commandType:'SaveEvent'}});
  try{await run;}catch(e){const log=JSON.stringify(runtimeLogEvent(1,'variables','failed',e));expect(log).toContain('scene_event_permission');expect(log).not.toContain('remoteEvent');expect(log).not.toContain('误会');expect(log).not.toContain('stack');}
 }
 expect(a.state).toEqual(before);
});
it.each(['from','past','future'] as const)('好感前值与互动时间%s仍严格拒绝',async kind=>{
 const a=fixture();a.state.npc.friend.lastInteractionAt='2026-10-18T08:01:00+08:00';
 const bad=kind==='from'?body.replace('"from":30','"from":0'):body.replace(`lastInteractionAt = "${time}"`,`lastInteractionAt = "2026-10-18T${kind==='past'?'08:00:00':'09:00:00'}+08:00"`);
 await expect(parseTextVariables(envelope(bad),a.state,a.draft)).rejects.toThrow();
});
it.each(['opening','regular'] as const)('%s最终Composer含真实目录、四字段记忆与现场语义',async mode=>{
 const a=fixture();a.draft.turnKind=mode;a.draft.story!.turnKind=mode;
 if(mode==='opening'){a.state.turnNumber=0;a.state.journal=[];}
 const p=await composePrompt({stage:'variables',mode,state:a.state,draft:a.draft,userInput:'解释误会',settings:defaultSettings()});
 const sent=p.messages.map(m=>m.content).join('\n');
 for(const text of ['active仍为active不是变化','mention不授权','affinityChange','relationshipText','四字段','lastInteractionAt','程序会将时钟优先应用'])expect(sent).toContain(text);
 expect(sent).not.toContain('正文实际涉及的现场事件使用 set events');
});
it('文本多命令候选保存→Commit→重载；失败保留Story和正式状态',async()=>{
 const a=fixture(),factory=new IDBFactory(),repo=await SaveRepository.open('variables-contract',factory);
 a.state.turnNumber=0;a.state.journal=[];a.initial=createTurnDraft(a.state.saveId,0,'current','opening','');a.draft=rerollStory(a.initial,{...story,turnKind:'opening'});
 try {
  await repo.create(a.state);await repo.saveDraft(a.initial,null);await repo.saveDraft(a.draft,0);
  await expect(parseTextVariables(envelope(body+'\nset events[remoteEvent].sceneState = {"status":"active"}'),a.state,a.draft)).rejects.toThrow();
  expect((await repo.loadDraft(a.state.saveId))?.story).toEqual(a.draft.story);expect(await repo.load(a.state.saveId)).toEqual(a.state);
  const nextStory=rerollStory(a.draft,{...story,turnKind:'opening'});
  const result=await parseTextVariables(envelope(body),a.state,nextStory);
  const saved=await completeDraft(repo,{variables:result,world:{worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]}});
  const committed=await repo.commitTurn(submission(saved,''));
  expect(committed.state.npc.friend.affinity).toBe(32);expect(committed.state.events).toEqual(a.state.events);
  repo.close();const reopened=await SaveRepository.open('variables-contract',factory);try{expect(await reopened.load(a.state.saveId)).toEqual(committed.state);}finally{reopened.close();}
 }finally{repo.close();}
});

it('Story明确enter后可在预计结束前真实结案，不改规划时间',async()=>{
 const a=fixture();a.draft.story!.variableGuide=[{group:'event',observedFact:'介入并完成本幕处理',eventNarration:{eventId:'remoteEvent',mode:'enter',at:time}}];
 const result=await parseTextVariables(envelope(body+'\nset events[remoteEvent].sceneState = '+JSON.stringify({status:'resolved',resolvedAt:time,outcome:'changed',resolutionText:'本幕处理结束'})),a.state,a.draft);
 const p=projectTurn(a.state,a.draft,result.commands);expect(p.events.remoteEvent.status).toBe('resolved');expect(p.events.remoteEvent.estimatedEndAt).toBe(a.state.events.remoteEvent.estimatedEndAt);
});
