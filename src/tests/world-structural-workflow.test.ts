import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { teahouse } from './fixtures/teahouse';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { submission } from './fixtures/turn';
import { stageResponses } from '../services/ai/stageResponses';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { parseWorld } from '../services/validation/aiOutputs';

const resources:{dispose:()=>void}[]=[];
afterEach(()=>{resources.splice(0).forEach(r=>r.dispose());stageResponses.clear();});
async function setup() {
 const a=teahouse(),factory=new IDBFactory(), name='teahouse-world';
 const repo=await SaveRepository.open(name,factory);resources.push({dispose:()=>repo.close()});
 await repo.create(a.state);
 const initial=createTurnDraft(a.state.saveId,0,a.draft.turnId,'opening','');
 await repo.saveDraft(initial,null);await repo.saveDraft(rerollStory(initial,a.draft.story!),0);
 const draft=await repo.saveDraft({...a.draft,draftRevision:2},1);
 const values=new Map<string,string>(),store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
 const config=defaultAiConfig(),channel={...newChannel(),defaultModel:'mock-world'};
 config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock-world'};
 const vault=new CredentialVault(store,store);vault.set(channel.id,'test-only-credential');
 const transport=vi.fn<typeof fetch>(async()=>Response.json({choices:[{message:{content:JSON.stringify(a.response)},finish_reason:'stop'}]}));
 const stage=new WorldStage(repo,new AiClient(transport));resources.push(stage);
 return {...a,factory,name,repo,draft,stage,transport,options:{config,vault,settings:defaultSettings()}};
}
describe('用户茶楼样例经真实Runtime、候选、Commit与重载',()=>{
 it('单次Mock请求保存候选；关联补齐、离场任务和历史一并原子提交；刷新及双库重放不重复',async()=>{
  const a=await setup(), before=await a.repo.load(a.state.saveId);
  const candidate=await a.stage.generate({...a.options,draft:a.draft});
  expect(a.transport).toHaveBeenCalledTimes(1);expect(await a.repo.load(a.state.saveId)).toEqual(before);
  expect(candidate.world?.validation).toBe('validated');expect(candidate.story).toEqual(a.draft.story);expect(candidate.variables).toEqual(a.draft.variables);
  // 不要求模型重复填写；原始文本和命令ID保留，反向关系在同一领域事务中形成。
  const task=candidate.world!.result.taskCommands[0];expect(task.type==='SaveTask'&&task.task.linkedEventId).toBeUndefined();
  const input=submission(candidate,''),committed=await a.repo.commitTurn(input);
  expect(committed.state.tasks.task_chen_fetch_credentials.linkedEventId).toBe('event_jumingxuan_standoff');
  expect(committed.state.events.event_jumingxuan_standoff.linkedTaskIds).toEqual(['task_chen_fetch_credentials']);
  expect(committed.state.npc.npc_chen_zhiyuan.onScene).toBe(false);expect(committed.state.npc.npc_zhou_fuhua.onScene).toBe(true);
  expect(committed.state.timeline).toHaveLength(1);expect(committed.state.journal).toHaveLength(1);
  expect(committed.state.protagonist).toEqual(before.protagonist);expect(committed.state.economy).toEqual(before.economy);
  expect(committed.state.npc.npc_zhou_fuhua.memories).toEqual(before.npc.npc_zhou_fuhua.memories);
  expect(committed.draft.story).toBeUndefined();expect(committed.draft.userInput).toBe('');
  const other=await SaveRepository.open(a.name,a.factory);resources.push({dispose:()=>other.close()});
  const replay=await other.commitTurn(input);expect(replay.replayed).toBe(true);expect(replay.state).toEqual(committed.state);
  a.repo.close();expect((await other.loadGame(a.state.saveId)).state).toEqual(committed.state);
  expect(a.transport).toHaveBeenCalledTimes(1);
 });
 it('无效父地点失败保留上游、提供安全定位；明确重试一次后可提交',async()=>{
  const a=await setup(), original=structuredClone(a.response), before=await a.repo.load(a.state.saveId);
  a.response.worldCommands[0].location!.parentId='not-real-private-parent';
  let caught:unknown;try{await a.stage.generate({...a.options,draft:a.draft});}catch(e){caught=e;}
  expect(runtimeLogEvent(1,'world','failed',caught)).toMatchObject({code:'data_integrity',worldRule:'location_reference',commandIndex:1,commandType:'CreateLocation',fieldPath:'worldCommands.0.location.parentId'});
  expect(JSON.stringify(runtimeLogEvent(1,'world','failed',caught))).not.toContain('not-real-private-parent');
  const failed=(await a.repo.loadDraft(a.state.saveId))!;
  expect(failed.stageStatus.world).toBe('failed');expect(failed.world).toBeUndefined();expect(failed.story).toEqual(a.draft.story);expect(failed.variables).toEqual(a.draft.variables);
  expect(await a.repo.load(a.state.saveId)).toEqual(before);expect(a.transport).toHaveBeenCalledTimes(1);
  a.response.worldCommands=original.worldCommands;
  const candidate=await a.stage.generate({...a.options,draft:failed});
  await a.repo.commitTurn(submission(candidate,''));expect(a.transport).toHaveBeenCalledTimes(2);
 });
 it('伪造validated候选仍在Commit重验拒绝，整个正式状态和草稿保持不变',async()=>{
  const a=await setup(),candidate=await a.stage.generate({...a.options,draft:a.draft});
  const forged=structuredClone(candidate);forged.draftRevision++;forged.world!.candidateRevision++;
  const task=forged.world!.result.taskCommands[0];if(task.type!=='SaveTask')throw Error('fixture');
  task.task.linkedEventId='invented-event';
  const stored=await a.repo.saveDraft(TurnDraftSchema.parse(forged),candidate.draftRevision),before=await a.repo.load(a.state.saveId);
  await expect(a.repo.commitTurn(submission(stored,''))).rejects.toMatchObject({details:{worldRule:'task_event_link'}});
  expect(await a.repo.load(a.state.saveId)).toEqual(before);expect(await a.repo.loadDraft(a.state.saveId)).toEqual(stored);
 });
 it('另一标签页改变Story后，旧World和提交不得覆盖新草稿',async()=>{
  const a=await setup(),candidate=await a.stage.generate({...a.options,draft:a.draft});
  const other=await SaveRepository.open(a.name,a.factory);resources.push({dispose:()=>other.close()});
  const next=await other.saveDraft(rerollStory(candidate,{...candidate.story!,summary:'新的正文版本'}),candidate.draftRevision);
  await expect(a.repo.commitTurn(submission(candidate,''))).rejects.toMatchObject({code:'DRAFT_CONFLICT'});
  await expect(a.stage.generate({...a.options,draft:candidate})).rejects.toMatchObject({code:'DRAFT_CONFLICT'});
  expect(await other.loadDraft(a.state.saveId)).toEqual(next);expect((await other.load(a.state.saveId)).revision).toBe(0);expect(a.transport).toHaveBeenCalledTimes(1);
 });
 it('取消后迟到响应不会保存候选或正式状态',async()=>{
  const a=await setup();let release!:(r:Response)=>void;
  a.transport.mockImplementationOnce(()=>new Promise<Response>(r=>{release=r;}));
  const pending=a.stage.generate({...a.options,draft:a.draft});const rejected=expect(pending).rejects.toBeDefined();
  await vi.waitFor(()=>expect(a.transport).toHaveBeenCalledTimes(1));a.stage.cancel();
  release(Response.json({choices:[{message:{content:JSON.stringify(a.response)},finish_reason:'stop'}]}));await rejected;
  expect((await a.repo.loadDraft(a.state.saveId))?.world).toBeUndefined();expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
 });
 it('旧式双方已填写的合法候选继续通过，不需迁移存档或增加请求',async()=>{
  const a=await setup(),raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:'event_jumingxuan_standoff'}}]};
  const result=parseWorld(JSON.stringify(raw),a.state,a.draft);
  const candidate=await a.repo.saveDraft({...a.draft,draftRevision:a.draft.draftRevision+1,world:{storyRevision:1,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated',result},stageStatus:{...a.draft.stageStatus,world:'ready'}},a.draft.draftRevision);
  await a.repo.commitTurn(submission(candidate,''));expect(a.transport).not.toHaveBeenCalled();
 });
});
