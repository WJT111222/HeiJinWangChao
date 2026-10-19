import { promptManifest } from './manifest';
import type { PromptModule } from './manifest';
import { readPromptResource } from './loader';
import { checkedInput, contextFor, contextMessage, worldWeekday } from './context';
import type { ComposeInput } from './context';
import type { AiMessage } from '../services/ai/protocols';
import { AiError } from '../services/ai/errors';

export interface ModuleRecord {
  id: string;
  version: string;
  contentSha256: string;
  role: AiMessage['role'];
  order: number;
  characters: number;
}
export async function composePrompt(unchecked: ComposeInput) {
  const input = checkedInput(unchecked);
  const domainSet = new Set(input.domains ?? []);
  const knownDomains = new Set(promptManifest.modules.filter((m) => m.domain).map((m) => m.domain));
  if ([...domainSet].some((domain) => !knownDomains.has(domain)))
    throw new AiError('configuration');
  if (
    input.stage === 'memory' &&
    !promptManifest.modules.some((m) => m.id === input.memoryTask && m.activation === 'memory-task')
  )
    throw new AiError('configuration');
  const selected = promptManifest.modules.filter((module) => {
    if (
      module.activation === 'never' ||
      !module.applicableStages.includes(input.stage) ||
      !module.modes.includes(input.mode)
    )
      return false;
    if (module.activation === 'always') return true;
    if (module.activation === 'relevant-domain') return domainSet.has(module.domain!);
    if (module.activation === 'memory-task') return module.id === input.memoryTask;
    if (module.activation === 'protocol-compatibility')
      return input.stage === 'story' && input.cotAllowed === true;
    const [field, value] = module.toggle!.split(':');
    return String(input.settings.prompts[field as keyof typeof input.settings.prompts]) === value;
  });
  const overrides = input.orderOverrides ?? {};
  for (const [id, order] of Object.entries(overrides)) {
    const module = selected.find((m) => m.id === id);
    if (!module?.reorderable || !Number.isInteger(order)) throw new AiError('configuration');
  }
  for (const group of new Set(selected.filter((m) => m.reorderable).map((m) => m.orderGroup))) {
    const members = selected.filter((m) => m.reorderable && m.orderGroup === group);
    const current = members.map((m) => overrides[m.id] ?? m.defaultOrder).sort((a, b) => a - b);
    const slots = members.map((m) => m.defaultOrder).sort((a, b) => a - b);
    if (current.join() !== slots.join()) throw new AiError('configuration');
  }
  const order = (m: PromptModule) => overrides[m.id] ?? m.defaultOrder;
  selected.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  if (
    new Set(selected.map((m) => m.id)).size !== selected.length ||
    new Set(selected.map((m) => m.path)).size !== selected.length
  )
    throw new AiError('configuration');
  const context = contextFor(input);
  const clock =
    typeof context.worldClock === 'string' ? context.worldClock : input.state.worldClock;
  const replacements: Record<string, string | number | undefined> = {
    playerName: input.state.protagonist.name,
    worldClock: clock,
    worldWeekday: worldWeekday(clock),
    minNarrativeChars: input.settings.prompts.minNarrativeChars,
    immediateMemoryTurns: input.settings.memory.immediateWindowSize,
    npcId: input.npcId,
    npcSummaryThreshold: input.npcSummaryThreshold,
  };
  const records: ModuleRecord[] = [];
  const messages: AiMessage[] = [];
  let confirmation: AiMessage | undefined;
  for (const module of selected) {
    let content = await readPromptResource(module.id);
    content = content.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, key: string) => {
      const value = replacements[key];
      if (value === undefined || String(value).trim() === '') throw new AiError('placeholder');
      return JSON.stringify(String(value))
        .slice(1, -1)
        .replace(/[<>]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    });
    const role = module.messageRole!;
    records.push({
      id: module.id,
      version: module.version,
      contentSha256: module.contentSha256,
      role,
      order: order(module),
      characters: Array.from(content).length,
    });
    if (role === 'assistant') confirmation = { role, content };
    else messages.push({ role, content });
  }
  messages.push({
    role: 'user',
    content: contextMessage({ ...context, PROMPT_SETTINGS: input.settings.prompts }),
  });
  if (confirmation) messages.push(confirmation);
  if (messages.some((m) => /\{\{[^{}]*\}\}/.test(m.content))) throw new AiError('placeholder');
  return {
    messages,
    modules: records,
    context,
    baseSaveRevision: input.state.revision,
    storyRevision: input.draft?.storyRevision,
    audience: 'internal' as const,
  };
}
