import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { runStageRequest } from '../services/ai/runtime';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory, VariableResultSchema } from '../domain/drafts';
import { game, story } from './fixtures/game';

function setup(protocol:Protocol='openai') {
  const config=defaultAiConfig(),channel=newChannel(protocol);channel.defaultModel='mock-model';channel.compatibility.jsonMode=true;
  config.channels=[channel];config.routes.story={channelId:channel.id,modelId:''};
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const vault=new CredentialVault(storage,storage);vault.set(channel.id,'mock-key');
  const state=game();state.openingTimePending=true;state.worldClock='0001-01-01T00:00:00+08:00';
  const draft=rerollStory(createTurnDraft(state.saveId,0,'live-turn','opening',''),{...story,turnKind:'opening',variableGuide:[{group:'time',subjectHint:'time:opening',observedFact:JSON.stringify({startAt:'2015-07-08T08:00:00+08:00',endAt:'2015-07-08T08:05:00+08:00'})}]});
  const input={stage:'variables' as const,mode:'opening' as const,state,draft,settings:defaultSettings(),userInput:'',domains:['protagonist']};
  return {config,vault,input};
}
function wire(text:string,protocol:Protocol) {
  return Response.json(protocol==='openai'?{choices:[{message:{content:text},finish_reason:'stop'}]}:protocol==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]}:{content:[{type:'text',text}],stop_reason:'end_turn'});
}
describe('正式Variables文本请求',()=>{
  it.each(['openai','gemini','anthropic'] as const)('%s启用JSON Mode仍请求文本；空开局候选只含一次程序时钟',async(protocol)=>{
    const a=setup(protocol),before=structuredClone(a.input),transport=vi.fn<typeof fetch>(async()=>wire('<命令></命令>',protocol));
    const response=await runStageRequest(a.input,a.config,a.vault,{},new AiClient(transport));
    const result=VariableResultSchema.parse(response.result);
    expect(result.commands).toEqual([{type:'SetWorldClock',commandId:'opening-clock:1',worldClock:'2015-07-08T08:05:00+08:00',evidence:'Story结构化开局时间'}]);
    expect(response.modules.some(m=>m.id==='stages.opening.variables.text')).toBe(true);
    const body=JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('response_format');expect(body.generationConfig??{}).not.toHaveProperty('responseMimeType');
    expect(JSON.stringify(body)).toContain('TEXT_COMMAND_CATALOG');expect(transport).toHaveBeenCalledTimes(1);expect(a.input).toEqual(before);
  });
});
