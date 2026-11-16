import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { stageResponses } from '../services/ai/stageResponses';
import { StoryStage } from '../workflows/storyStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { RuntimeLogPanel } from '../ui/game/RuntimeLogPanel';
import { currentRuntimeLogs, runtimeLogEvent } from '../ui/game/runtimeLog';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

const opened: SaveRepository[] = [], runners: { dispose(): void }[] = [];
afterEach(() => { runners.splice(0).forEach(r => r.dispose()); opened.splice(0).forEach(r => r.close()); stageResponses.clear(); vi.restoreAllMocks(); });
const text = (body = '短') => `<thinking>合成计划</thinking><正文>${body}</正文><短期记忆>观察街道。</短期记忆><变量规划>[]</变量规划>`;
async function setup(transport?: typeof fetch) {
  const idb = new IDBFactory(), name = 'failure-summary', repo = await SaveRepository.open(name, idb); opened.push(repo);
  const state = game(); await repo.create(state);
  const draft = createTurnDraft(state.saveId, state.revision, 'synthetic-turn', 'opening', ''); await repo.saveDraft(draft, null);
  const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://summary.mock.invalid/v1'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.variables = {mode:'independent',channelId:channel.id,modelId:'variables'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};
  const data = new Map<string,string>(), storage = {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
  const vault = new CredentialVault(storage, storage); vault.set(channel.id,'synthetic-credential');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
  const fetcher = vi.fn<typeof fetch>(transport ?? (async()=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:text()}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})));
  const client = new AiClient(fetcher), runner = new StoryStage(repo,client); runners.push(runner);
  return {repo,idb,name,state,draft,fetcher,runner,client,input:{draft,settings,config,vault}};
}
function failedDraft() { const d=createTurnDraft('synthetic-save',8,'synthetic-turn','regular','行动原文'); return TurnDraftSchema.parse({...d,stageStatus:{...d.stageStatus,story:'failed'},failures:[{stage:'story',attempt:2,storyRevision:0,errorCode:'invalid_output',retryable:false}]}); }

describe('manual failure persistence through real Repository, Runtime and parser',()=>{
 it('persists only the safe summary, not Story, raw text or detailed diagnostics; reopening preserves it',async()=>{
  const r=await setup(), saved=vi.fn<(d:TurnDraft)=>void>();
  await expect(r.runner.generate({...r.input,onFailureSaved:saved})).rejects.toMatchObject({code:'invalid_output',details:{storyRule:'narrative_short'}});
  expect(r.fetcher).toHaveBeenCalledTimes(1);expect(await r.repo.load(r.state.saveId)).toEqual(r.state);
  const d=await r.repo.loadDraft(r.state.saveId);expect(d).toMatchObject({draftRevision:1,userInput:r.draft.userInput,storyRevision:0,stageStatus:{story:'failed'},failures:[{stage:'story',attempt:1,storyRevision:0,errorCode:'invalid_output',retryable:false}]});
  expect(d?.story).toBeUndefined();expect(saved).toHaveBeenCalledWith(d);expect(JSON.stringify(d)).not.toMatch(/narrative_short|synthetic-credential|合成计划/);
  const reopened=await SaveRepository.open(r.name,r.idb);opened.push(reopened);expect(await reopened.loadDraft(r.state.saveId)).toEqual(d);
 });
 it('automatic failures are still recorded exactly once, and a later manual attempt adds one summary',async()=>{
  const r=await setup(), coordinator=new TurnCoordinator(r.repo,r.client);runners.push(coordinator);
  await expect(coordinator.generate(r.input)).rejects.toMatchObject({code:'invalid_output'});
  const d=await r.repo.loadDraft(r.state.saveId);expect(d?.failures).toHaveLength(1);
  await expect(r.runner.generate({...r.input,draft:d!,onFailureSaved:vi.fn()})).rejects.toMatchObject({code:'invalid_output'});
  const after=await r.repo.loadDraft(r.state.saveId);expect(after?.failures).toHaveLength(2);expect(after?.failures.at(-1)?.attempt).toBe(2);expect(r.fetcher).toHaveBeenCalledTimes(2);
 });
 it('success after a manual failure keeps the existing input and does not create another failure',async()=>{
  const r=await setup();await expect(r.runner.generate({...r.input,onFailureSaved:vi.fn()})).rejects.toMatchObject({code:'invalid_output'});
  const failed=await r.repo.loadDraft(r.state.saveId);r.fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({choices:[{delta:{content:text('主角在街道边安静观察。')}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}));
  const next=await r.runner.generate({...r.input,draft:failed!,onFailureSaved:vi.fn()});expect(next.stageStatus.story).toBe('ready');expect(next.storyRevision).toBe(1);expect(next.failures).toHaveLength(1);expect(next.userInput).toBe(r.draft.userInput);expect(await r.repo.load(r.state.saveId)).toEqual(r.state);expect(r.fetcher).toHaveBeenCalledTimes(2);
 });
 for(const change of ['cancel','draft','state'] as const)it(`${change} during a request cannot write a stale failure`,async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r),started=vi.fn();
  const r=await setup(async()=>{started();await gate;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:text()}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});});
  const saved=vi.fn(),pending=r.runner.generate({...r.input,onFailureSaved:saved}).catch(e=>e);await vi.waitFor(()=>expect(started).toHaveBeenCalledTimes(1));
  if(change==='cancel')r.runner.cancel();
  if(change==='draft')await r.repo.saveDraft({...r.draft,draftRevision:r.draft.draftRevision+1},r.draft.draftRevision);
  if(change==='state')await r.repo.save(r.state.saveId,r.state.revision,'independent-write',[{type:'UpdateProtagonist',commandId:'independent',expectedRevision:r.state.revision,protagonistId:r.state.protagonist.id,evidence:'合成独立写入',changes:{emotionText:'平静'}}]);
  const before=await r.repo.loadGame(r.state.saveId);release();const error:unknown=await pending;expect(error).toBeInstanceOf(Error);expect(await r.repo.loadGame(r.state.saveId)).toEqual(before);expect(saved).not.toHaveBeenCalled();expect((await r.repo.loadDraft(r.state.saveId))?.failures).toHaveLength(0);expect(r.fetcher).toHaveBeenCalledTimes(1);
 });
 it('failure-summary storage errors are surfaced without changing either state or draft',async()=>{
  const r=await setup();vi.spyOn(r.repo,'saveDraft').mockRejectedValueOnce(new Error('synthetic-storage-failure'));
  await expect(r.runner.generate({...r.input,onFailureSaved:vi.fn()})).rejects.toThrow('synthetic-storage-failure');
  expect(await r.repo.load(r.state.saveId)).toEqual(r.state);expect(await r.repo.loadDraft(r.state.saveId)).toEqual(r.draft);expect(r.fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('saved summary and temporary logs are different read-only data',()=>{
 it('explains a saved failure when temporary logs are absent, with stage, code and attempt',()=>{
  const draft=failedDraft(),before=structuredClone(draft),html=renderToStaticMarkup(<RuntimeLogPanel draft={draft} entries={[]} onClear={()=>{}}/>);
  expect(html).toContain('持久失败摘要');expect(html).toContain('invalid_output');expect(html).toContain('第 2 次');expect(html).toContain('本页没有该次请求的详细运行日志');expect(html).not.toContain('本次页面尚无错误');expect(html).not.toContain('narrative_short');expect(draft).toEqual(before);
 });
 it('does not treat a pending draft or an obsolete summary as a current failure',()=>{
  const d=failedDraft();const pending=TurnDraftSchema.parse({...d,stageStatus:{...d.stageStatus,story:'pending'},failures:[]});
  const html=renderToStaticMarkup(<RuntimeLogPanel draft={pending} entries={[]} onClear={()=>{}}/>);expect(html).toContain('本页暂无错误');expect(html).not.toContain('invalid_output');
 });
 it('a cancelled response is not a model failure, even if received from a catch path',()=>{
  const entry=runtimeLogEvent(1,'story','failed',new AiError('cancelled'));expect(entry.kind).toBe('cancelled');
  const html=renderToStaticMarkup(<RuntimeLogPanel entries={[entry]} onClear={()=>{}}/>);expect(html).toContain('错误 0 条');expect(html).toContain('已取消');expect(html).not.toContain('最近错误');
 });
 it('isolates page-local save/turn tokens and stops presenting recovered failures as current',()=>{
  const scope={saveRef:crypto.randomUUID(),turnRef:crypto.randomUUID()},otherSave={...scope,saveRef:crypto.randomUUID()},otherTurn={...scope,turnRef:crypto.randomUUID()};
  const event=runtimeLogEvent(1,'story','failed',new AiError('invalid_output'),scope);
  const rows=[event,runtimeLogEvent(2,'story','failed',new AiError('authorization'),otherSave),runtimeLogEvent(3,'story','failed',new AiError('network'),otherTurn)];
  expect(currentRuntimeLogs(rows,scope)).toEqual([event]);
  const completed=runtimeLogEvent(4,'story','completed',undefined,scope);expect(currentRuntimeLogs([...rows,completed],scope)).toEqual([completed]);
  expect(event.scope).toEqual(scope);expect(JSON.stringify(event)).not.toMatch(/synthetic-save|synthetic-turn/);
  expect(currentRuntimeLogs([completed, event],scope)).toEqual([completed,event]); // A later failure is real even with a previously ready candidate.
 });
 it('does not show previous Story versions as a saved current failure',()=>{
  const old=failedDraft(),next=TurnDraftSchema.parse({...old,storyRevision:1});
  const html=renderToStaticMarkup(<RuntimeLogPanel draft={next} entries={[]} onClear={()=>{}}/>);
  expect(html).not.toContain('invalid_output');expect(html).toContain('本页暂无错误');
 });
});
