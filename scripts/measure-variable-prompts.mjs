// Run against either checkout with the same fixed story, action and save.
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import process from 'node:process';
import { log, warn } from 'node:console';

const root = resolve(argv[2] || '.');
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
  const load = path => server.ssrLoadModule('/src/' + path + '.ts');
  const [{ composePrompt }, { worldState, worldDraft }, { defaultSettings }, { estimateTokens },
    { promptManifest }, { selectVariableDomains }] = await Promise.all([
    load('prompts/composer'), load('tests/fixtures/world'), load('ui/settings/model'),
    load('prompts/statistics'), load('prompts/manifest'), load('prompts/variableDomains'),
  ]);
  const state = worldState(), draft = worldDraft(), settings = defaultSettings();
  const stages = promptManifest.modules.some(module => module.applicableStages.includes('entities'))
    ? ['entities', 'variables', 'world'] : ['variables', 'world'];
  const rows = [];
  for (const stage of stages) {
    const { messages, context, modules } = await composePrompt({ stage, mode: 'regular', state, draft,
      settings, userInput: draft.userInput, domains: selectVariableDomains(state, draft).domains });
    const catalog = JSON.stringify(context.TEXT_COMMAND_CATALOG ?? context.COMMAND_CATALOG);
    const special = modules.flatMap((record, index) => {
      const category = promptManifest.modules.find(module => module.id === record.id).category;
      return ['stage', 'output', 'variable_group'].includes(category) ? [messages[index].content] : [];
    });
    const dedicated = [...special, catalog, messages.at(-1).content].join('\n');
    const all = messages.map(message => message.content).join('\n');
    rows.push({ stage, dedicatedChars: Array.from(dedicated).length, dedicatedTokenEstimate: estimateTokens(dedicated).estimatedTokens,
      totalChars: Array.from(all).length, totalTokenEstimate: estimateTokens(all).estimatedTokens });
  }
  log(JSON.stringify(rows, null, 2));
  if (stages.length === 3) {
    const sizes = rows.map(row => row.dedicatedChars);
    if (Math.max(...sizes) > 60_000) process.exitCode = 1;
    if (Math.max(...sizes) > Math.min(...sizes) * 1.2) warn('三段专属提示词字数差异超过 20%');
  }
} finally { await server.close(); }
