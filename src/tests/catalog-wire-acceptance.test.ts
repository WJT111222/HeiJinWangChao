import { afterEach, afterAll, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { requestFixtureStage } from './fixtures/stageRequest';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { stageResponses } from '../services/ai/stageResponses';
import { composePrompt } from '../prompts/composer';
import { contextStatistics, estimateTokens } from '../prompts/statistics';
import { defaultSettings } from '../ui/settings/model';
import { worldState } from './fixtures/world';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { inlineRecoveryNarrative } from './fixtures/storyRecovery';

const measurements: unknown[] = [];
afterEach(() => { vi.useRealTimers(); stageResponses.clear(); });
afterAll(async () => {
  if (process.env.PR153_WIRE_EVIDENCE) await writeFile(process.env.PR153_WIRE_EVIDENCE, JSON.stringify(measurements, null, 2));
});
for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const)
for (const mode of ['opening', 'regular'] as const)
for (const stage of ['story', 'variables', 'world'] as const) {
  it(`${protocol} ${mode} ${stage}: 正式组装→真实wire→单次Mock；尾提醒及独立上下文完整`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-15T00:00:00Z'));
    const state = worldState(), settings = defaultSettings();
    if (mode === 'regular') { state.turnNumber = 1; state.journal.push({turnId:'previous-catalog',revision:0,relatedActorRefs:[],story:{turnKind:'opening',narrative:inlineRecoveryNarrative,summary:'核对笔记',variableGuide:[]}}); }
    const draft = rerollStory(createTurnDraft(state.saveId,state.revision,'catalog-wire',mode,''),{turnKind:mode,narrative:inlineRecoveryNarrative,summary:'核对笔记',variableGuide:[]});
    const input = { state, draft, settings, stage, mode, userInput: '' }, before = structuredClone(input);
    const channel = newChannel(protocol), config = defaultAiConfig(); channel.id = 'catalog-channel';
    channel.baseUrl = 'http://127.0.0.1:1'; channel.defaultModel = 'mock-catalog';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    const values = new Map<string,string>(), storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'synthetic-catalog-key');
    const content = stage === 'story'
      ? `<正文>${inlineRecoveryNarrative}</正文><短期记忆>主角核对笔记。</短期记忆><变量规划>[]</变量规划><行动选项>继续核对\n看看周围\n留在原处</行动选项>`
      : stage === 'variables' ? '<thinking>没有新增变化。</thinking><说明></说明><命令></命令>'
        : JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(protocol === 'gemini'
      ? {candidates:[{content:{parts:[{text:content}]},finishReason:'STOP'}]}
      : protocol === 'anthropic' ? {content:[{type:'text',text:content}],stop_reason:'end_turn'}
        : {choices:[{message:{content},finish_reason:'stop'}]}));
    await requestFixtureStage(input, config, vault, {stream:false}, new AiClient(fetcher));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(input).toEqual(before);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    const messages: {role:string;content:string}[] = protocol === 'gemini'
      ? body.contents.map((row:{role:string;parts:{text:string}[]})=>({role:row.role,content:row.parts.map(p=>p.text).join('')})) : body.messages;
    expect(messages.at(-1)?.role).toBe('user'); expect(messages.at(-1)?.content).toContain('【最终格式提醒】');
    const contexts = messages.filter(m=>/^<GAME_CONTEXT>\n[\s\S]*\n<\/GAME_CONTEXT>$/.test(m.content)); expect(contexts).toHaveLength(1);
    const context = JSON.parse(contexts[0].content.replace(/^<GAME_CONTEXT>\n|\n<\/GAME_CONTEXT>$/g,''));
    if(stage === 'world') expect(context.COMMAND_CATALOG).toHaveProperty('schema.oneOf');
    else expect(context).not.toHaveProperty('COMMAND_CATALOG');
    expect(JSON.stringify(body)).not.toContain('synthetic-catalog-key');
    const serialized = JSON.stringify(body), promptStats = contextStatistics((await composePrompt(input)).messages);
    const catalogChars = context.COMMAND_CATALOG ? JSON.stringify(context.COMMAND_CATALOG).length : null;
    measurements.push({protocol,mode,stage,body,promptStats,catalogChars,utf16:serialized.length,characters:Array.from(serialized).length,bytes:Buffer.byteLength(serialized),heuristic:estimateTokens(serialized)});
  });
}
