import { afterEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { canContinueStory, continuationBlock } from '../domain/storyContinuation';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { defaultSettings } from '../ui/settings/model';
import { worldState } from '../tests/fixtures/world';
import { TurnCoordinator } from '../workflows/turnCoordinator';

import { AiError } from '../services/ai/errors';
const evidence: unknown[]=[];
const full='<正文>【旁白】他走过街边，停下来观察行人，然后决定回家。</正文><短期记忆>他观察街景后准备回家。</短期记忆><变量规划>[]</变量规划><行动选项>沿街走走\n回家休息\n询问路人</行动选项>';
const resources: {dispose?:()=>void;close?:()=>void}[]=[];afterEach(()=>{for(const r of resources.splice(0).reverse()){r.dispose?.();r.close?.()}stageResponses.clear();});
function setup(stream=true){const settings=defaultSettings();settings.runtime.streamStory=stream;settings.runtime.useVariableStage=false;settings.runtime.useWorldStage=false;settings.prompts.actionOptions=true;settings.prompts.minNarrativeChars=5;
 const channel=newChannel(),config=defaultAiConfig();channel.baseUrl='https://investigation.mock.invalid/v1';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock-story'};
 const m=new Map<string,string>(),store={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)}};const vault=new CredentialVault(store,store);vault.set(channel.id,'mock-only-secret');return{settings,config,vault};}
function wire(text:string,finish:string,stream:boolean,layout='same'){if(!stream)return Response.json({choices:[{message:{content:text},finish_reason:finish}]});
 const event=(content?:string,reason?:string)=>`data: ${JSON.stringify({choices:[{delta:content===undefined?{}:{content},...(reason?{finish_reason:reason}:{})}]})}\n\n`;
 return new Response((layout==='separate'?event(text)+event(undefined,finish):layout==='missing-done'?event(text):event(text,finish))+(layout==='missing-done'?'':'data: [DONE]\n\n'),{headers:{'content-type':'text/event-stream'}});}
async function fixture(stream:boolean){const repo=await SaveRepository.open(`probe-${crypto.randomUUID()}`,new IDBFactory());resources.push(repo);const state=worldState();await repo.create(state);const draft=createTurnDraft(state.saveId,0,'probe-turn','opening','',false,false);await repo.saveDraft(draft,null);return{repo,state,draft,...setup(stream)};}
const cases=[
 {id:'complete-stop',text:full,finish:'stop'},
 {id:'complete-length',text:full,finish:'length'},
 {id:'body-cut',text:'<正文>【旁白】他走过街边，准备',finish:'length'},
 {id:'memory-cut',text:'<正文>【旁白】他走过街边后回家。</正文><短期记忆>他观察',finish:'length'},
 {id:'last-close-missing',text:full.replace('</行动选项>',''),finish:'stop'},
 {id:'closed-short',text:full.replace('【旁白】他走过街边，停下来观察行人，然后决定回家。','短'),finish:'stop'},
 {id:'closed-short-length',text:full.replace('【旁白】他走过街边，停下来观察行人，然后决定回家。','短'),finish:'length'},
 {id:'invalid-guide',text:full.replace('>[]</变量规划>','>{bad}</变量规划>'),finish:'stop'},
 {id:'invalid-guide-length',text:full.replace('>[]</变量规划>','>{bad}</变量规划>'),finish:'length'},
 {id:'options-missing',text:full.replace(/<行动选项>[\s\S]*$/,''),finish:'stop'},
 {id:'options-unexpected',text:full,finish:'stop',actions:false},
];
for(const stream of [false,true])for(const c of cases){it(`matrix stream=${stream} ${c.id}`,async()=>{
 const f=await fixture(stream);if(c.actions===false)f.settings.prompts.actionOptions=false;
 let strict: {ok:boolean;chars?:number;code?:string;rule?:unknown};try{strict={ok:true,chars:parseStoryEnvelope(c.text,'opening',f.settings).story.narrative.length}}catch(caught){const e=caught as AiError;strict={ok:false,code:e.code,rule:e.details?.storyRule}}
 let calls=0;const r=new TurnCoordinator(f.repo,new AiClient(async()=>{calls++;return wire(c.text,c.finish,stream)}));resources.push(r);let error:AiError|undefined;let out:Awaited<ReturnType<TurnCoordinator['generate']>>|undefined;
 try{out=await r.generate(f)}catch(e){error=e as AiError}const draft=(await f.repo.loadDraft(f.state.saveId))!;
 const got={stream,id:c.id,strict,status:out?.status,error:error?.code,rule:error?.details?.storyRule,calls,partial:draft.storyPartial?.text===c.text,partialLength:draft.storyPartial?.text.length??0,continuable:canContinueStory(draft,5),block:continuationBlock(draft,5),formalUnchanged:JSON.stringify(await f.repo.load(f.state.saveId))===JSON.stringify(f.state)};evidence.push(got);
 expect(calls).toBe(1);expect(got.formalUnchanged).toBe(true);
 if(!strict.ok){expect(error).toBeDefined();expect(draft.story).toBeUndefined();}
 if(['body-cut','memory-cut'].includes(c.id)){expect(error!.code).toBe('output_limit');expect(got.partial).toBe(true);expect(got.continuable).toBe(true);}
 if(c.id==='complete-stop'){expect(draft.story).toBeDefined();expect(out!.status).toBe('complete');}
 if(c.id==='complete-length'){expect(error).toBeUndefined();expect(draft.story).toBeDefined();expect(got.partial).toBe(false);expect(strict.ok).toBe(true);}
 if(c.id==='closed-short-length')expect(error!.details?.storyRule).toBe('narrative_short');
 if(c.id==='invalid-guide-length'){expect(error!.code).toBe('invalid_json');expect(got.continuable).toBe(false);}
 });}

for(const stream of [false,true])for(const protocol of ['openai','deepseek','gemini','anthropic'] as const)it(`四协议完整limit严格保存 ${protocol} stream=${stream}`,async()=>{
 const f=await fixture(stream);f.config.channels[0].protocol=protocol;f.config.channels[0].baseUrl='https://protocol.mock.invalid';let calls=0;const shown:string[]=[];
 const value=protocol==='openai'||protocol==='deepseek'?{choices:[{[stream?'delta':'message']:{content:full},finish_reason:'length'}]}:protocol==='gemini'?{candidates:[{content:{parts:[{text:full}]},finishReason:'MAX_TOKENS'}]}:{content:[{type:'text',text:full}],stop_reason:'max_tokens'};
 const event=(v:unknown)=>`data: ${JSON.stringify(v)}\n\n`;
 const r=new TurnCoordinator(f.repo,new AiClient(async()=>{calls++;return !stream?Response.json(value):new Response(protocol==='anthropic'?event({type:'content_block_delta',delta:{type:'text_delta',text:full}})+event({type:'message_delta',delta:{stop_reason:'max_tokens'}})+event({type:'message_stop'}):event(value),{headers:{'content-type':'text/event-stream'}})}));resources.push(r);
 const done=await r.generate({...f,onProgress:p=>{if(p.narrative)shown.push(p.narrative)}});
 expect(calls).toBe(1);expect(done.draft.stageStatus.story).toBe('ready');expect(done.draft.story?.narrative).toContain('决定回家');expect(done.draft.storyPartial).toBeUndefined();
 if(stream)expect(shown.join('')).toContain('决定回家');
 expect(stageResponses.getSnapshot()[0].diagnostics?.finishReasons).toContain(protocol==='openai'||protocol==='deepseek'?'length':protocol==='gemini'?'MAX_TOKENS':'max_tokens');
});
for(const stream of [false,true])it(`limit不得掩盖拒绝信息 stream=${stream}`,async()=>{
 const f=await fixture(stream);const value={choices:[{[stream?'delta':'message']:{content:full,refusal:'mock refusal'},finish_reason:'length'}]};
 const r=new TurnCoordinator(f.repo,new AiClient(async()=>stream?new Response(`data: ${JSON.stringify(value)}\n\n`,{headers:{'content-type':'text/event-stream'}}):Response.json(value)));resources.push(r);
 await expect(r.generate(f)).rejects.toMatchObject({code:'content_filter'});expect((await f.repo.loadDraft(f.state.saveId))?.story).toBeUndefined();expect(await f.repo.load(f.state.saveId)).toEqual(f.state);
});
