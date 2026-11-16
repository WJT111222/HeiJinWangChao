import { defaultAiConfig, newChannel } from '../../services/ai/configuration';
import type { Protocol } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { defaultSettings } from '../../ui/settings/model';

export function talentAi(protocol: Protocol = 'deepseek') {
  const channel = newChannel(protocol), config = defaultAiConfig();
  channel.baseUrl = 'http://127.0.0.1:1/v1'; channel.defaultModel = 'talent-mock'; channel.compatibility.cotMode = 'off';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
  const values = new Map<string, string>(), storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'synthetic-talent-key');
  const settings = defaultSettings(); settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 5;
  settings.runtime.streamStory = false;
  for (const summary of Object.values(settings.memory.summaries)) summary.automatic = false;
  return { config, vault, settings };
}
export function talentJson(protocol: Protocol, text: string) {
  return Response.json(protocol === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
    : protocol === 'anthropic' ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}
export function talentStory(narrative: string) {
  return `<正文>${narrative}</正文><短期记忆>核对物流企业资料，保持玩家决定权。</短期记忆><变量规划>[]</变量规划>`;
}
export function talentSse(text: string) {
  const data = [...text].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(data); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) controller.close();
    else { controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7; }
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
