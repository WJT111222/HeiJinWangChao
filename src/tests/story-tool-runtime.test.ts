import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { channelSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { runStageRequest } from '../services/ai/runtime';
import { stageResponses } from '../services/ai/stageResponses';
import { requestInspections } from '../services/ai/inspection';
import { StoryStage } from '../workflows/storyStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { createTurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { composePrompt } from '../prompts/composer';
import { game } from './fixtures/game';
import { worldState, worldDraft, worldNarrative, worldResult } from './fixtures/world';
import { variableReply } from './fixtures/variableReply';
import { carrierResponse, toolFrame, toolStoryText } from './fixtures/storyTools';
import { splitResponse } from './fixtures/responseEvents';
import { STORY_OUTPUT_TOOL } from '../services/ai/storyToolContract';
import type { Protocol } from '../services/ai/configuration';

function setup(protocol: Protocol = 'openai', model = 'mock-model') {
  const config = defaultAiConfig(), channel = newChannel(protocol), values = new Map<string, string>();
  channel.defaultModel = model; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: model };
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'fictional-tool-key');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false; settings.runtime.storyToolOutput = true;
  return { config, channel, vault, settings };
}
const messages = [{ role: 'system' as const, content: '原有系统规则' }, { role: 'user' as const, content: '原有 Story 协议' }];
afterEach(() => { vi.restoreAllMocks(); stageResponses.clear(); requestInspections.clear(); });

describe('Story工具模式请求与原严格解析', () => {
  for (const protocol of ['openai','deepseek','gemini','anthropic'] as const) for (const stream of [false,true]) {
    it(`${protocol} / stream=${stream}：仅一次请求、原文与正文分离、严格Story校验`, async () => {
      const input = setup(protocol), calls: Record<string, unknown>[] = [];
      const client = new AiClient(async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return carrierResponse(protocol, stream); });
      const onDelta = vi.fn();
      const result = await runStageRequest({ stage: 'story', mode: 'opening', userInput: '', state: game(), settings: input.settings }, input.config, input.vault, { stream, onDelta }, client);
      expect(result.result).toMatchObject({ narrative: '中文🙂，3<5。', summary: '事实', variableGuide: [] });
      expect(calls).toHaveLength(1); expect(calls[0].tools).toBeDefined();
      const raw = stageResponses.getSnapshot()[0];
      expect(raw.status).toBe('validated'); expect(raw.text).toBe(JSON.stringify({ content: toolStoryText }));
      expect(JSON.parse(raw.text).content).toBe(toolStoryText);
      expect(raw.displayText).toBe(raw.text);
      if (stream) expect(onDelta.mock.calls.map(call => call[0]).join('')).toBe(toolStoryText);
      else expect(onDelta).not.toHaveBeenCalled();
    });
  }
  for (const protocol of ['openai','deepseek','gemini','anthropic'] as const) {
    it(`${protocol}工具开关不改原消息/参数；禁用时完全保留原wire`, () => {
      const input = setup(protocol), snap = channelSnapshot(input.channel, input.vault);
      const original = wireRequest(snap, messages, true), enabled = wireRequest(snap, messages, true, true);
      expect(wireRequest(snap, messages, true, false)).toEqual(original);
      const body = JSON.parse(String(enabled.init.body)), old = JSON.parse(String(original.init.body));
      expect(body.tools).toHaveLength(1); delete body.tools;
      if (protocol === 'gemini') delete body.toolConfig; else delete body.tool_choice;
      if (protocol === 'openai') { expect(body.parallel_tool_calls).toBe(false); delete body.parallel_tool_calls; }
      expect(body).toEqual(old);
    });
  }
  it('Anthropic原生Thinking不被关闭，也不发送与Thinking冲突的强制tool_choice', () => {
    const input = setup('anthropic','claude-sonnet-4-6'), snap = channelSnapshot(input.channel, input.vault);
    const body = JSON.parse(String(wireRequest(snap,messages,true,true).init.body));
    expect(body.thinking).toEqual({ type:'adaptive',display:'summarized' });
    expect(body.tool_choice).toEqual({ type:'auto',disable_parallel_tool_use:true });
  });
  it.each(['variables','world','memory'] as const)('%s不能请求Story工具载体，发送前拒绝', async stage => {
    const input = setup(), transport = vi.fn();
    await expect(new AiClient(transport).generate(channelSnapshot(input.channel,input.vault,'model',stage),messages,{storyToolOutput:true})).rejects.toMatchObject({code:'configuration'});
    expect(transport).not.toHaveBeenCalled();
  });
  it('旧设置缺少字段时默认关闭，不改版本及其他配置；开关不注入Prompt', async () => {
    const input = setup(), old = structuredClone(input.settings) as unknown as {runtime:Record<string,unknown>}; delete old.runtime.storyToolOutput;
    const parsed = SettingsSchema.parse(old); expect(parsed.runtime.storyToolOutput).toBe(false);
    const { storyToolOutput: _flag, ...runtime } = parsed.runtime; void _flag;
    expect(runtime).toEqual(old.runtime); expect(parsed.version).toBe(1);
    const state=game(), a=await composePrompt({stage:'story',mode:'opening',userInput:'',state,settings:parsed});
    const b=await composePrompt({stage:'story',mode:'opening',userInput:'',state,settings:input.settings});
    expect(b).toEqual(a);
  });
  it.each(['short','json','actions','time'])('载体Schema合法但Story业务非法仍拒绝：%s', async kind => {
    const input=setup();input.settings.prompts.minNarrativeChars=kind==='short'?1000:1;
    const text=kind==='json'?toolStoryText.replace('>[]</变量规划>','>not-json</变量规划>')
      :kind==='actions'?toolStoryText+'<行动选项>擅自多出</行动选项>'
      :kind==='time'?toolStoryText.replace('>[]</变量规划>','>[{"group":"time","observedFact":"错误时间","timeOutcome":{"kind":"resolved","at":"2020-01-01T00:00:00+08:00"}}]</变量规划>'):toolStoryText;
    const transport=vi.fn(async()=>carrierResponse('deepseek',false,JSON.stringify({content:text})));
    await expect(runStageRequest({stage:'story',mode:'opening',userInput:'',state:game(),settings:input.settings},input.config,input.vault,{stream:false},new AiClient(transport))).rejects.toBeDefined();
    expect(transport).toHaveBeenCalledTimes(1); expect(stageResponses.getSnapshot()[0].status).toBe('failed');
  });
  it('length与过滤即使参数已经闭合也不冒充工具成功，不自动重发', async () => {
    for(const reason of ['length','content_filter']) {
      const input=setup(), transport=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'c',type:'function',function:{name:STORY_OUTPUT_TOOL,arguments:JSON.stringify({content:toolStoryText})}}]},finish_reason:reason}]})));
      await expect(new AiClient(transport).generate(channelSnapshot(input.channel,input.vault),messages,{storyToolOutput:true,validateStoryOutputLimit:true})).rejects.toMatchObject({code:reason==='length'?'output_limit':'content_filter'});
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('JSON回退、独立reasoning和usage保留；原生思考不成为Story文本', async()=>{
    const input=setup('deepseek'), received:string[]=[],raw:string[]=[];
    const reply=await carrierResponse('deepseek',false).json();reply.choices[0].message.reasoning_content='公开原生思考';reply.usage={prompt_tokens:10,completion_tokens:4,total_tokens:14,prompt_cache_hit_tokens:3};
    const transport=vi.fn(async()=>Response.json(reply));
    const result=await new AiClient(transport).generate(channelSnapshot(input.channel,input.vault),messages,{storyToolOutput:true,stream:true,onDelta:d=>received.push(d),onRawTextDelta:d=>raw.push(d)});
    expect(result.text).toBe(toolStoryText);expect(received.join('')).toBe(toolStoryText);expect(raw.join('')).toBe(JSON.stringify({content:toolStoryText}));
    expect(result.nativeReasoning).toBe('公开原生思考');expect(result.usage).toEqual({inputTokens:10,outputTokens:4,totalTokens:14,cacheReadTokens:3});expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('正式StoryStage / Repository / 协调器保护',()=>{
  let repo:SaveRepository;
  beforeEach(async()=>{repo=await SaveRepository.open('tool-stage',new IDBFactory());await repo.create(game());await repo.saveDraft(createTurnDraft('save-a',0,'tool-turn','opening',''),null);});
  afterEach(()=>repo.close());
  it('合法载体只保存一次Story草稿，正式世界不变',async()=>{
    const input=setup('deepseek'), before=await repo.loadGame('save-a'), save=vi.spyOn(repo,'saveDraft');
    const stage=new StoryStage(repo,new AiClient(async()=>carrierResponse('deepseek',true)));
    const draft=await stage.generate({...input,draft:before.draft!});
    expect(draft.stageStatus.story).toBe('ready');expect(save).toHaveBeenCalledTimes(1);expect(await repo.load('save-a')).toEqual(before.state);
    stage.dispose();
  });
  it('网络断在参数内部：部分原文可查，但没有伪造Story partial或候选',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');
    const prefix=toolFrame({choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:STORY_OUTPUT_TOOL,arguments:'{"content":"<正文>不完整'}}]}}]});
    const stage=new StoryStage(repo,new AiClient(async()=>splitResponse(prefix,1)));
    await expect(stage.generate({...input,draft:before.draft!})).rejects.toMatchObject({code:'tool_response'});
    expect(await repo.loadGame('save-a')).toEqual(before);expect(stageResponses.getSnapshot()[0].text).toContain('不完整');stage.dispose();
  });
  it('取消与迟到工具响应不保存候选，也不触发额外请求',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');let release!:(r:Response)=>void;
    const transport=vi.fn(()=>new Promise<Response>(r=>{release=r;})),stage=new StoryStage(repo,new AiClient(transport));
    const pending=stage.generate({...input,draft:before.draft!}).catch(e=>e);await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    stage.cancel();expect(await pending).toMatchObject({code:'cancelled'});release(carrierResponse('openai',true));await new Promise(r=>setTimeout(r,5));
    expect(await repo.loadGame('save-a')).toEqual(before);expect(transport).toHaveBeenCalledTimes(1);stage.dispose();
  });
  it('草稿CAS变化后，迟到合法结果不覆盖新草稿',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');let release!:(r:Response)=>void;
    const transport=vi.fn(()=>new Promise<Response>(r=>{release=r;})),stage=new StoryStage(repo,new AiClient(transport));
    const pending=stage.generate({...input,draft:before.draft!}).catch(e=>e);await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    await repo.saveDraft({...before.draft!,draftRevision:1},0);release(carrierResponse('openai',false));
    expect((await pending).code).toBe('DRAFT_CONFLICT');expect((await repo.loadDraft('save-a'))?.story).toBeUndefined();expect(await repo.load('save-a')).toEqual(before.state);stage.dispose();
  });
  it('IDB写入故障不产生部分Story或正式世界写入',async()=>{
    const input=setup(),before=await repo.loadGame('save-a'), stage=new StoryStage(repo,new AiClient(async()=>carrierResponse('openai',false)));
    const original=IDBObjectStore.prototype.put;vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='drafts')throw new DOMException('mock quota','QuotaExceededError');return original.apply(this,args);});
    await expect(stage.generate({...input,draft:before.draft!})).rejects.toBeDefined();expect(await repo.loadGame('save-a')).toEqual(before);stage.dispose();
  });
  it('载体中的凭证回显仍被StoryStage拒绝，正式状态和草稿不变',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');
    const text=toolStoryText.replace('中文🙂，3<5。','fictional-tool-key');
    const stage=new StoryStage(repo,new AiClient(async()=>carrierResponse('openai',false,JSON.stringify({content:text}))));
    await expect(stage.generate({...input,draft:before.draft!})).rejects.toMatchObject({details:{storyRule:'credential_output'}});
    expect(await repo.loadGame('save-a')).toEqual(before);expect(JSON.stringify(stageResponses.getSnapshot())).not.toContain('fictional-tool-key');stage.dispose();
  });
  it('工具参数完整但Story尾部截断：仅保存解码后的正文，主动续写仍复用原合并和校验',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');let calls=0;
    const prefix='<正文>【旁白】雨水沿着站台落下。';
    const transport=vi.fn(async()=>carrierResponse('openai',true,JSON.stringify({content:++calls===1?prefix:'</正文><短期记忆>等待</短期记忆><变量规划>[]</变量规划>'})));
    const stage=new StoryStage(repo,new AiClient(transport));
    await expect(stage.generate({...input,draft:before.draft!,onFailureSaved:()=>undefined})).rejects.toBeDefined();
    const failed=(await repo.loadDraft('save-a'))!;expect(failed.storyPartial?.text).toBe(prefix);expect(failed.story).toBeUndefined();
    const result=await stage.generate({...input,draft:failed,continuation:true});
    expect(result.stageStatus.story).toBe('ready');expect(result.story?.narrative).toBe('【旁白】雨水沿着站台落下。');expect(result.storyPartial).toBeUndefined();expect(transport).toHaveBeenCalledTimes(2);expect(await repo.load('save-a')).toEqual(before.state);stage.dispose();
  });
  it('参数未完整时仅保存既有失败元数据，绝不把原始JSON草稿冒充可续写正文',async()=>{
    const input=setup(),before=await repo.loadGame('save-a');
    const prefix=toolFrame({choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:STORY_OUTPUT_TOOL,arguments:'<正文>恶意未编码参数'}}]}}]});
    const stage=new StoryStage(repo,new AiClient(async()=>splitResponse(prefix,1)));
    await expect(stage.generate({...input,draft:before.draft!,onFailureSaved:()=>undefined})).rejects.toMatchObject({code:'tool_response'});
    const after=await repo.loadGame('save-a');expect(after.state).toEqual(before.state);expect(after.draft?.story).toBeUndefined();expect(after.draft?.storyPartial).toBeUndefined();expect(after.draft?.stageStatus.story).toBe('failed');stage.dispose();
  });
  it('Story工具输出→Variables→World→Commit各一次，后续阶段没有tools',async()=>{
    const input=setup('deepseek'),state=worldState();repo.close();repo=await SaveRepository.open('tool-auto',new IDBFactory());await repo.create(state);await repo.saveDraft(createTurnDraft('save-a',0,'auto','opening',''),null);
    input.config.routes.story.modelId='story';input.config.routes.variables={mode:'independent',channelId:input.channel.id,modelId:'variables'};input.config.routes.world={mode:'independent',channelId:input.channel.id,modelId:'world'};
    const bodies:Record<string,unknown>[]=[],text=`<正文>${worldNarrative}</正文><短期记忆>已完成用餐</短期记忆><变量规划>[]</变量规划>`;
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));bodies.push(body);
      if(body.model==='story')return carrierResponse('deepseek',true,JSON.stringify({content:text}));
      return Response.json({choices:[{message:{content:body.model==='variables'?variableReply(worldDraft().variables!.result):JSON.stringify(worldResult())},finish_reason:'stop'}]});});
    const runner=new TurnCoordinator(repo,new AiClient(transport));const commit=vi.spyOn(repo,'commitTurn');
    try{const result=await generateAndSettleTurn(runner,repo,{...input,draft:(await repo.loadDraft('save-a'))!},{check:()=>undefined,onSettling:()=>undefined});
      expect(result.committed?.state.turnNumber).toBe(1);expect(commit).toHaveBeenCalledTimes(1);expect(bodies.map(b=>b.model)).toEqual(['story','variables','world']);
      expect(bodies[0].tools).toBeDefined();expect(bodies.slice(1).every(b=>b.tools===undefined&&b.tool_choice===undefined)).toBe(true);
    }finally{runner.dispose();}
  });
});
