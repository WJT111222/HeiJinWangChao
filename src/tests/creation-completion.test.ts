import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { completeCreation } from '../services/ai/creationCompletion';
import type { CreationCompletionInput } from '../services/ai/creationCompletion';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestInspections } from '../services/ai/inspection';
import { promptManifest } from '../prompts/manifest';
import { readPromptResource } from '../prompts/loader';
import { moduleActivation } from '../prompts/selection';
import sourceLock from '../../prompts/sources.lock.json';
import { defaultSettings } from '../ui/settings/model';

const validJob = {
  professionDescription:'处理合同与咨询事项。',
  professionSkills:['条款审阅','争议分析','资料检索','证据组织'],
  professionLongTermImpact:'长期积累法律实务知识与合作关系。',
};
const person = { name: '林舟', age: '30', gender: '女性' };
const freshJob: CreationCompletionInput = {
  kind:'profession', person, profession:'律师', professionDescription:'', professionSkills:'', professionLongTermImpact:'',
};
function setup(reply: string, finishReason = 'stop') {
  const map = new Map<string,string>();
  const store = { getItem:(key:string)=>map.get(key)??null, setItem:(key:string,value:string)=>{map.set(key,value);},
    removeItem:(key:string)=>{map.delete(key);} };
  const vault = new CredentialVault(store,store), config = defaultAiConfig();
  const channel = {...newChannel('openai'),baseUrl:'https://creation.mock.invalid/v1',defaultModel:'unused-default',
    parameters:{temperature:0.65,maxOutputTokens:18000}};
  const other = {...newChannel('openai'),defaultModel:'wrong-stage'};
  config.channels = [channel, other];
  config.routes.story = {channelId:channel.id,modelId:'explicit-story'};
  config.routes.variables = {mode:'independent',channelId:other.id,modelId:''};
  vault.set(channel.id,'fixture-creation-token');
  const transport=vi.fn<typeof fetch>(async()=>Response.json({choices:[{message:{content:reply},finish_reason:finishReason}]}));
  const run = (input: CreationCompletionInput, signal = new AbortController().signal) =>
    completeCreation(input,config,vault,{signal,timeoutSeconds:15},new AiClient(transport));
  const sent = () => JSON.parse(String(transport.mock.calls[0][1]?.body));
  return {run,config,channel,vault,transport,sent};
}
describe('创角独立请求',()=>{
  it.each([
    [{kind:'appearance',person,appearance:'身材高大，帮我写 300 字'} as const,'150–200','外貌正文'],
    [{kind:'personality',person,personality:'冷静谨慎，简单描述，100 字'} as const,'150–200','性格正文'],
    [{kind:'background',person,background:'社区长大，扩写到 800 字',profession:'修复师',personality:'谨慎'} as const,'300–500','背景正文'],
  ])('出站独立模块，保留显式要求及已有内容 %#',async(input,range,marker)=>{
    const {run,transport,sent}=setup('示例纯文本，长度是目标。');
    const inspected = requestInspections.getSnapshot();
    await expect(run(input)).resolves.toMatchObject({kind:input.kind,text:'示例纯文本，长度是目标。'});
    const {kind,...fields}=input;
    const body=sent();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({role:'system',content:await readPromptResource('creation.'+kind)});
    expect(body.messages[0].content).toContain(range);
    expect(body.messages[0].content).toContain(marker);
    expect(body.messages[0].content).toMatch(/明确.*(篇幅|长度)/u);
    expect(body.messages[0].content).toMatch(/姓名、年龄(?:和|、)性别/u);
    expect(JSON.parse(body.messages[1].content)).toEqual(fields);
    expect(body).toMatchObject({model:'explicit-story',temperature:0.65,stream:false});
    expect(JSON.stringify(body)).not.toContain('fixture-creation-token');
    expect(transport).toHaveBeenCalledExactlyOnceWith('https://creation.mock.invalid/v1/chat/completions',
      expect.objectContaining({credentials:'omit',redirect:'error',headers:expect.objectContaining({Authorization:'Bearer fixture-creation-token'})}));
    expect(requestInspections.getSnapshot()).toBe(inspected);
  });

  it('职业空三字段使用默认 4 项，一次返回完整对象，原模型配置保持原样',async()=>{
    const {run,transport,sent,config}=setup(JSON.stringify(validJob));
    const before=structuredClone(config);
    await expect(run(freshJob)).resolves.toEqual({kind:'profession',fields:validJob});
    expect(transport).toHaveBeenCalledTimes(1);
    const body=sent();
    expect(body.messages[0].content).toMatch(/professionDescription 默认 150–200[\s\S]*professionSkills 默认 4[\s\S]*professionLongTermImpact 默认 100–150/u);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      person,profession:'律师',professionDescription:'',professionSkills:'',professionLongTermImpact:'',
    });
    expect(config).toEqual(before);
  });

  it('基本信息允许为空，也不会被解释为补全的篇幅和技能数量要求',async()=>{
    const blank = setup('示例外貌。');
    const emptyPerson = { name:'', age:'', gender:'' };
    await expect(blank.run({kind:'appearance',person:emptyPerson,appearance:''})).resolves.toMatchObject({text:'示例外貌。'});
    expect(JSON.parse(blank.sent().messages[1].content)).toEqual({person:emptyPerson,appearance:''});
    expect(blank.transport).toHaveBeenCalledTimes(1);
    const job = setup(JSON.stringify(validJob));
    await job.run({...freshJob,person:{...person,name:'10000 字，技能 99 项'}});
    expect(job.sent().max_tokens).toBe(4096);
  });

  it('将介绍字数、技能 6 项、影响字数分别传入，预算适配大篇幅且不超过渠道上限',async()=>{
    const six={...validJob,professionSkills:[...validJob.professionSkills,'谈判支持','合规复核']};
    const explicit={...freshJob,professionDescription:'介绍 1600 字，已有草稿',professionSkills:'技能 6 项',
      professionLongTermImpact:'长期影响写 300 字'};
    const {run,sent,transport}=setup(JSON.stringify(six));
    await expect(run(explicit)).resolves.toEqual({kind:'profession',fields:six});
    expect(sent().max_tokens).toBeGreaterThan(4096);
    expect(sent().max_tokens).toBeLessThanOrEqual(18000);
    expect(sent().messages[0].content).toMatch(/明确指定介绍或长期影响的篇幅时，只调整相应字段。明确指定技能项数时，按该项数输出/u);
    expect(JSON.parse(sent().messages[1].content)).toMatchObject({
      professionDescription:explicit.professionDescription,professionSkills:'技能 6 项',professionLongTermImpact:explicit.professionLongTermImpact,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const capped=setup(JSON.stringify(six));
    capped.channel.parameters.maxOutputTokens=1550;
    await capped.run(explicit);
    expect(capped.sent().max_tokens).toBe(1550);
  });

  it.each([
    ['缺字段',JSON.stringify({professionDescription:'已返回一段'}),'invalid_output','stop'],
    ['错误 JSON','{invalid}','invalid_output','stop'],
    ['擅加职业名',JSON.stringify({...validJob,profession:'新职业'}),'invalid_output','stop'],
    ['擅加人物基本信息',JSON.stringify({...validJob,person:{name:'改名', age:'80', gender:'男性'}}),'invalid_output','stop'],
    ['空技能',JSON.stringify({...validJob,professionSkills:[]}),'invalid_output','stop'],
    ['单项含换行',JSON.stringify({...validJob,professionSkills:['原行\n错误行']}),'invalid_output','stop'],
    ['输出截断',JSON.stringify(validJob),'output_limit','length'],
    ['凭证回显',JSON.stringify({...validJob,professionDescription:'fixture-creation-token'}),'invalid_output','stop'],
  ])('%s 畸形响应失败且不自动重发',async(_name,reply,code,finish)=>{
    const {run,transport}=setup(reply,finish);
    await expect(run(freshJob)).rejects.toMatchObject({code});
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('职业缺名称、配置缺失、输入含凭证和预取消都不发送',async()=>{
    const {run,transport,vault,channel,config}=setup('不会发送');
    vault.set(config.channels[1].id, 'fixture+/secret');
    await expect(run({...freshJob,profession:'  '})).rejects.toMatchObject({code:'configuration'});
    await expect(run({kind:'appearance',person,appearance:'fixture-creation-token'})).rejects.toMatchObject({code:'credentials'});
    await expect(run({kind:'personality',person,personality:'fixture%2B%2Fsecret'})).rejects.toMatchObject({code:'credentials'});
    await expect(run({kind:'background',person:{...person,name:'fixture%2B%2Fsecret'},background:'',profession:'',personality:''}))
      .rejects.toMatchObject({code:'credentials'});
    const cancel=new AbortController(); cancel.abort();
    await expect(run(freshJob,cancel.signal)).rejects.toMatchObject({code:'cancelled'});
    vault.delete(channel.id);
    await expect(run(freshJob)).rejects.toMatchObject({code:'credentials'});
    expect(transport).not.toHaveBeenCalled();
  });

  it('真实封装超时终止单次传输，HTTP 失败也不自动重发',async()=>{
    const {config,vault}=setup('');
    const transport=vi.fn<typeof fetch>(async()=>new Promise<Response>(()=>{}));
    const timed=completeCreation(freshJob,config,vault,{signal:new AbortController().signal,timeoutSeconds:0.025},new AiClient(transport));
    await expect(timed).rejects.toMatchObject({code:'timeout'});
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const failed=vi.fn<typeof fetch>(async()=>new Response('',{status:500}));
    await expect(completeCreation(freshJob,config,vault,{signal:new AbortController().signal},new AiClient(failed)))
      .rejects.toMatchObject({code:'server',status:500});
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it.each(['appearance','personality','profession','background'] as const)('注册资源 %s 有独立来源，永远不拼进游戏阶段',kind=>{
    const module=promptManifest.modules.find(item=>item.id==='creation.'+kind)!, settings=defaultSettings();
    expect(module).toMatchObject({activation:'creation-action',category:'creation',orderGroup:'creation'});
    expect(sourceLock.resources[`creation/${kind}.md`].creationIdentityContext.sha256).toBe(module.contentSha256);
    for (const stage of ['story','variables','world','memory'] as const)
      for (const mode of ['opening','regular'] as const)
        expect(moduleActivation(module,{stage,mode,settings}).status).toBe('not-applicable');
  });
});
