import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { stageResponses } from '../services/ai/stageResponses';
import { parseWorld } from '../services/validation/aiOutputs';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { chronicle, historyCommand } from './fixtures/historyV2';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';
import { event } from './fixtures/game';
import { sentContext } from './fixtures/contextAssertions';
import { record } from '../services/ai/protocols';

const resources: { dispose: () => void }[] = [];
afterEach(() => { resources.splice(0).forEach(r => r.dispose()); stageResponses.clear(); });
it.each(['opening','regular'] as const)('%s最终World消息包含新Schema及一致归档规则，不连接历史分类AI',async mode=>{
 const state=worldState(),draft=worldDraft();draft.turnKind=mode;draft.story!.turnKind=mode;
 const prompt=await composePrompt({state,draft,stage:'world',mode,userInput:'继续',settings:defaultSettings()});
 const text=prompt.messages.map(m=>m.content).join('\n');
 expect(text).toContain('世界重大事件实际结束后才归档');expect(text).toContain('冬季不跨年');
 const context=sentContext(prompt.messages),catalog=record(context.COMMAND_CATALOG);
 expect(JSON.stringify(catalog)).toContain('"chronicle"');expect(JSON.stringify(catalog)).toContain('"scopeText"');
 expect(prompt.modules.some(r=>r.id==='memory.timeline_entry')).toBe(false);
 expect(prompt.modules.some(r=>r.id===`stages.${mode}.world`)).toBe(true);
});
it('实际World Runtime→Mock→候选→原子Commit→重载：一次请求同时结案和双视角归档',async()=>{
 const factory=new IDBFactory(),repo=await SaveRepository.open('history-runtime',factory);resources.push({dispose:()=>repo.close()});
 const state=worldState();state.events.investigation={...event('investigation'),status:'active',sourceTurnIds:[],actorRefs:[{kind:'npc',id:'npc-a'}]};
 await repo.create(state);
 const draft=await completeDraft(repo,{variables:{commands:[],unresolved:[],rejectedSuggestions:[]}});
 const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='mock-world';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock-world'};
 const memory=new Map<string,string>(),store={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
 const vault=new CredentialVault(store,store);vault.set(channel.id,'mock-history-key');
 const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));const context=sentContext(body.messages);expect(context.BASE_SAVE_REVISION).toBe(0);
  const live=state.events.investigation;
  const world=historyCommand('world-result',{...chronicle('shared-fact'),category:'world',scope:'organization',scopeText:'市立交通研究所',basis:'event_result',endTime:{precision:'instant',at:state.worldClock}});
  world.entry.eventId=live.id;
  const hero=historyCommand('hero-result',chronicle('shared-fact'));
  return Response.json({choices:[{message:{content:JSON.stringify({...worldResult([world,hero]),eventCommands:[{type:'SaveEvent',commandId:'conclude',evidence:'本轮结束调查',event:{...live,sourceTurnIds:[draft.turnId],status:'resolved',resolvedAt:state.worldClock,resolutionText:'已完成阶段调查。',outcome:'success'}}]})},finish_reason:'stop'}]});
 });
 const runner=new WorldStage(repo,new AiClient(fetcher));resources.push(runner);
 const candidate=await runner.generate({draft,settings:defaultSettings(),config,vault});
 expect(candidate.world?.validation).toBe('validated');expect(await repo.load(state.saveId)).toEqual(state);
 const result=await repo.commitTurn(submission(candidate));expect(result.state.timeline).toHaveLength(2);expect(result.state.events.investigation.status).toBe('resolved');
 expect(result.state.npc).toEqual(state.npc);expect(fetcher).toHaveBeenCalledTimes(1);
 const reload=await SaveRepository.open('history-runtime',factory);resources.push({dispose:()=>reload.close()});
 expect(await reload.load(state.saveId)).toEqual(result.state);expect((await reload.commitTurn(submission(candidate))).replayed).toBe(true);
});
it('重大纪事字段错误能定位到具体World命令，不暴露纪事正文',()=>{
 const cmd=historyCommand();cmd.entry.chronicle!.supportingTurnIds=['missing-turn'];
 try{parseWorld(JSON.stringify(worldResult([cmd])),worldState(),worldDraft());throw Error('expected rejection');}
 catch(error){expect(error).toBeInstanceOf(AiError);expect((error as AiError).details).toMatchObject({worldRule:'history_source',commandType:'RecordHistory',commandIndex:0,fieldPath:'worldCommands.0.entry.chronicle.supportingTurnIds.0'});expect(JSON.stringify((error as AiError).details)).not.toContain(cmd.entry.chronicle!.narrative);}
});
