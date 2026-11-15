import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composePrompt } from '../prompts/composer';
import { promptManifest } from '../prompts/manifest';
import { readPromptResource } from '../prompts/loader';
import { defaultSettings } from '../ui/settings/model';
import { stageContext } from './fixtures/eventStages';

it.each(['org_gang', 'org_government', 'org_civil', 'org_business'])('V10 %s 开局World实际加载独立init_world原文及共享状态协议', async domain => {
  const a = stageContext();
  const prompt = await composePrompt({ ...a, stage: 'world', mode: 'opening', userInput: a.draft.userInput, settings: defaultSettings(), domains: [domain] });
  const id = `variableGroups.${domain}.init.world`, path = `variableGroups/${domain}/init_world.md`;
  const entry = promptManifest.modules.find(module => module.id === id);
  expect(entry?.path).toBe(path); expect(prompt.modules.filter(module => module.id === id)).toHaveLength(1);
  const original = readFileSync(`prompts/${path}`, 'utf8');
  expect(await readPromptResource(id)).toBe(original);
  expect(prompt.messages.filter(message => message.content === original)).toHaveLength(1);
  for (const shared of ['shared.04_state_authority', 'shared.05_context_protocol'])
    expect(prompt.modules.filter(module => module.id === shared)).toHaveLength(1);
  expect(prompt.modules.some(module => module.id.endsWith('.text'))).toBe(false);
});
