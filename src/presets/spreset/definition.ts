// An opt-in localhost development preset. The ordinary preset selector never registers it.
import type { AssistantSelection } from '../library';
import type { PresetDefinition } from '../package';

export const prototypeId = 'spreset-c2';
export const definition: PresetDefinition = { id: prototypeId, version: 'c2.1-992e68afec42ebe0dfba5485445a801c93b0e38acf8620bb869a04a7838c2c30', lockedOff: [] };

export function selectedPrototype(selection: AssistantSelection | undefined): boolean {
  return import.meta.env.DEV && typeof selection === 'object' && selection?.definition.id === prototypeId;
}

export function prototypeRequested() {
  const location = globalThis.location;
  return import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(location?.hostname)
    && new URLSearchParams(location.search).get('spreset') === 'prototype';
}

export async function readPrototype() {
  const slots = ['charDescription', 'personaDescription', 'scenario', 'worldInfoBefore', 'worldInfoAfter', 'chatHistory'];
  const prompts = [{ identifier: 'c2-literature', role: 'system', content: '用简洁的中文写一幕生活场景。可使用 submit_scene 交付完整游戏输出。' },
    ...slots.map(identifier => ({ identifier, role: 'user', marker: true }))];
  return JSON.stringify({ prompts, prompt_order: [{ character_id: 100001, order: prompts.map(({ identifier }) => ({ identifier, enabled: true })) }] });
}
