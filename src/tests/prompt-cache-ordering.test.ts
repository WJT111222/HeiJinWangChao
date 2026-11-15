import { describe, expect, it } from 'vitest';
import { composePrompt, FIRST_DYNAMIC_CONTEXT_KEY, STABLE_CONTEXT_KEYS } from '../prompts/composer';
import { worldWeekday } from '../prompts/context';
import { selectVariableDomains } from '../prompts/variableDomains';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { channelSnapshot } from '../services/ai/snapshot';
import { anthropicMessage, wireRequest } from '../services/ai/protocols';
import type { AiMessage } from '../services/ai/protocols';
import { payloadMessages } from '../services/ai/inspection';
import { game, story } from './fixtures/game';

type Stage = 'story' | 'variables' | 'world';
async function turn(stage: Stage, index: number) {
  const state = game();
  state.turnNumber = index; state.revision = index;
  state.worldClock = new Date(Date.parse(state.worldClock) + index * 37 * 60_000).toISOString().replace('Z', '+00:00');
  state.journal = Array.from({ length: index }, (_, i) => ({ turnId: `t${i}`, revision: i, story: { ...story, narrative: `${story.narrative}（第${i}回合）` }, relatedActorRefs: [] }));
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, `turn-${index}`, 'regular', `第${index}回合行动`), { ...story, turnKind: 'regular' });
  const prompt = await composePrompt({ stage, mode: 'regular', state, draft, userInput: `第${index}回合行动`, settings: defaultSettings(),
    ...(stage === 'variables' ? { domains: selectVariableDomains(state, draft).domains } : {}) });
  return { prompt, state };
}
const contextOf = (messages: readonly AiMessage[]) => messages.find((m) => m.content.startsWith('<GAME_CONTEXT>'))!.content;
const parsed = (content: string) => JSON.parse(content.replace(/^<GAME_CONTEXT>\n/, '').replace(/\n<\/GAME_CONTEXT>$/, '')) as Record<string, unknown>;
const joined = (messages: readonly AiMessage[]) => messages.map((m) => `\n<<${m.role}>>\n${m.content}`).join('');

describe.each(['story', 'variables', 'world'] as const)('%s 提示词按缓存友好顺序组装', (stage: Stage) => {
  it('固定字段排在 GAME_CONTEXT 最前面，CURRENT_TIME 是第一个会变的字段，内容不增不减', async () => {
    const { prompt, state } = await turn(stage, 3);
    const context = parsed(contextOf(prompt.messages)), keys = Object.keys(context);
    const stable = STABLE_CONTEXT_KEYS.filter((key) => key in context);
    expect(keys.slice(0, stable.length)).toEqual(stable);
    expect(keys[stable.length]).toBe(FIRST_DYNAMIC_CONTEXT_KEY);
    expect(context.CURRENT_TIME).toEqual({ worldClock: state.worldClock, worldWeekday: worldWeekday(state.worldClock) });
    // 除新增的 CURRENT_TIME 与原本就附加的 PROMPT_SETTINGS 外，字段集合与组装器返回的上下文完全一致。
    // 值为 undefined 的字段本来就不会被 JSON 发送，比较时同样排除。
    const sentKeys = Object.keys(prompt.context).filter((key) => prompt.context[key] !== undefined);
    expect(keys.filter((key) => key !== 'CURRENT_TIME' && key !== 'PROMPT_SETTINGS').sort()).toEqual(sentKeys.sort());
    for (const key of sentKeys) expect(context[key]).toEqual(JSON.parse(JSON.stringify(prompt.context[key])));
  });
  it('当前时间不再写进 GAME_CONTEXT 之前的任何模块', async () => {
    const { prompt, state } = await turn(stage, 3);
    const modules = prompt.messages.slice(0, prompt.messages.findIndex((m) => m.content.startsWith('<GAME_CONTEXT>')));
    expect(joined(modules)).not.toContain(state.worldClock);
    expect(joined(modules)).toContain('GAME_CONTEXT.CURRENT_TIME.worldClock');
  });
  it('相邻两回合一字不差的开头一直延续到 CURRENT_TIME 的值', async () => {
    const a = joined((await turn(stage, 3)).prompt.messages), b = joined((await turn(stage, 4)).prompt.messages);
    let same = 0; while (same < a.length && a[same] === b[same]) same += 1;
    expect(same).toBeGreaterThanOrEqual(a.indexOf('"CURRENT_TIME":'));
    expect(same / a.length).toBeGreaterThan(0.8);
  });
});

function snapshot(protocol: Protocol) {
  const channel = { ...newChannel(protocol), defaultModel: 'cache-model' };
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'cache-mock-secret');
  return channelSnapshot(channel, vault, 'cache-model', 'world');
}
const body = (protocol: Protocol, messages: readonly AiMessage[]) => JSON.parse(wireRequest(snapshot(protocol), messages, false).init.body as string) as Record<string, unknown>;

describe('Claude 格式的缓存标记', () => {
  it('系统提示词一个标记，GAME_CONTEXT 固定部分末尾一个标记；拼回来与原文一字不差', async () => {
    const { prompt } = await turn('world', 3);
    const sent = body('anthropic', prompt.messages);
    const system = sent.system as Array<Record<string, unknown>>;
    expect(system).toEqual([{ type: 'text', text: prompt.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'), cache_control: { type: 'ephemeral' } }]);
    const conversation = sent.messages as Array<{ role: string; content: unknown }>;
    const split = conversation.filter((m) => Array.isArray(m.content));
    expect(split).toHaveLength(1);
    const blocks = split[0].content as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b.cache_control)).toEqual([{ type: 'ephemeral' }, undefined]);
    expect(String(blocks[0].text)).toContain('"COMMAND_CATALOG":');
    expect(String(blocks[0].text)).not.toContain('CURRENT_TIME');
    expect(String(blocks[1].text).startsWith('"CURRENT_TIME":')).toBe(true);
    expect(blocks.map((b) => b.text).join('')).toBe(contextOf(prompt.messages));
    // 提示词检查器能把带缓存标记的请求体还原成原始消息。
    expect(payloadMessages(sent, 'anthropic')).toEqual([
      { role: 'system', content: prompt.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') },
      ...prompt.messages.filter((m) => m.role !== 'system'),
    ]);
  });
  it('没有固定字段或不是 GAME_CONTEXT 的消息保持纯文本；没有系统提示词时不发空文本块', () => {
    expect(anthropicMessage({ role: 'user', content: '<GAME_CONTEXT>\n{"CURRENT_TIME":{}}\n</GAME_CONTEXT>' })).toEqual({ role: 'user', content: '<GAME_CONTEXT>\n{"CURRENT_TIME":{}}\n</GAME_CONTEXT>' });
    expect(anthropicMessage({ role: 'user', content: '玩家输入,"CURRENT_TIME":' })).toEqual({ role: 'user', content: '玩家输入,"CURRENT_TIME":' });
    expect(anthropicMessage({ role: 'assistant', content: '<GAME_CONTEXT>\n{"A":1,"CURRENT_TIME":2}' })).toEqual({ role: 'assistant', content: '<GAME_CONTEXT>\n{"A":1,"CURRENT_TIME":2}' });
    expect(body('anthropic', [{ role: 'user', content: '测试回复' }]).system).toBe('');
  });
  it('OpenAI、DeepSeek、Gemini 格式不带任何缓存字段，消息原样发送', async () => {
    const { prompt } = await turn('world', 3);
    for (const protocol of ['openai', 'deepseek', 'gemini'] as const) {
      const text = JSON.stringify(body(protocol, prompt.messages));
      expect(text).not.toContain('cache_control');
      expect(payloadMessages(body(protocol, prompt.messages), protocol).map((m) => m.content).join('')).toBe(
        protocol === 'gemini' ? [prompt.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'), ...prompt.messages.filter((m) => m.role !== 'system').map((m) => m.content)].join('')
          : prompt.messages.map((m) => m.content).join(''));
    }
  });
});
