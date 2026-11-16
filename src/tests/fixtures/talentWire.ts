import { createHash } from 'node:crypto';
import { composePrompt } from '../../prompts/composer';
import type { ComposeInput } from '../../prompts/context';
import { runStageRequest } from '../../services/ai/runtime';
import { AiClient } from '../../services/ai/client';
import { defaultAiConfig, newChannel } from '../../services/ai/configuration';
import type { AiStage, Protocol } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { payloadMessages, requestInspections } from '../../services/ai/inspection';
import { stageResponses } from '../../services/ai/stageResponses';

export const talentDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function captureTalentPrompt(input: ComposeInput) {
  const prompt = await composePrompt(input);
  return { messages: talentDigest(prompt.messages), context: talentDigest(prompt.context), modules: talentDigest(prompt.modules) };
}
// Shared test harness runs unchanged in a detached main checkout and the integration.
// Only synthetic credentials are used; neither headers nor credential values are exported.
export async function captureTalentWire(input: ComposeInput & { stage: AiStage }, protocol: Protocol, answer: string) {
  const config = defaultAiConfig(), channel = newChannel(protocol);
  channel.id = 'integration-channel'; channel.baseUrl = 'http://127.0.0.1:1/v1'; channel.compatibility.cotMode = 'off';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'synthetic-integration-key');
  const requests: { url: string; method: string; body: string; messages: string; characters: number }[] = [];
  const client = new AiClient(async (url, init) => {
    const body = String(init!.body);
    requests.push({ url: String(url), method: String(init!.method), body: talentDigest(body), messages: talentDigest(payloadMessages(JSON.parse(body), protocol)), characters: body.length });
    return Response.json(protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }] }
      : protocol === 'anthropic' ? { content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: answer }, finish_reason: 'stop' }] });
  });
  try { await runStageRequest(input, config, vault, { stream: false }, client); return requests; }
  finally { stageResponses.clear(); requestInspections.clear(); }
}
