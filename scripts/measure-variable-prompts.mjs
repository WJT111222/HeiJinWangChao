import { createServer } from 'vite';
import { resolve } from 'node:path';
import process from 'node:process';
import { log, warn } from 'node:console';
import { comparisonFixture, fixedEntityCandidate, fixedSceneCandidate } from './variable-comparison-fixture.mjs';

const server = await createServer({logLevel:'error', root: resolve(process.argv[2] || '.'), server: { middlewareMode: true }, appType: 'custom' });
let exceeded = false;
try {
  const load = path => server.ssrLoadModule('/src/' + path + '.ts');
  const [{ composePrompt }, { defaultSettings }, { estimateTokens }, { promptManifest }, { selectVariableDomains },
    { selectWorldDomains }, { projectTurn }] = await Promise.all([load('prompts/composer'), load('ui/settings/model'),
    load('prompts/statistics'), load('prompts/manifest'), load('prompts/variableDomains'), load('prompts/worldDomains'), load('domain/turnProjection')]);
  const { contextMessage } = await load('prompts/contextMessage');
  const settings = defaultSettings(), rows = [];
  for (const scenario of ['ordinary', 'scene-closure', 'historical', 'opening', 'organizations', 'opening-organizations', 'phone-inbox', 'private-chat', 'group-chat']) {
    const { state, draft, scene } = await comparisonFixture(load, scenario);
    const stages = 'useEntityStage' in draft ? ['entities', 'variables', 'world'] : ['variables', 'world'];
    for (const stage of stages) {
      if (stage === 'variables') fixedEntityCandidate(draft);
      if (stage === 'world') fixedSceneCandidate(draft, scene);
      const { domains } = stage === 'world' ? selectWorldDomains(projectTurn(state, draft), draft) : selectVariableDomains(state, draft, stage);
      const { messages, context, modules } = await composePrompt({ stage, mode: draft.turnKind, state, draft, settings, userInput: draft.userInput, domains });
      const special = modules.flatMap((record, index) => {
        const category = promptManifest.modules.find(module => module.id === record.id).category;
        return ['stage', 'output', 'variable_group'].includes(category) ? [messages[index].content] : [];
      });
      const catalog = contextMessage(context.TEXT_COMMAND_CATALOG ?? context.COMMAND_CATALOG);
      const wireCatalog = catalog.slice(catalog.indexOf('\n') + 1, catalog.lastIndexOf('\n'));
      const chatRules = [context.PHONE_CHAT?.rule, context.PHONE_CHAT?.groupRule, context.PHONE_CHAT_TIME?.rule, context.PHONE_CHAT_FOLLOWUP?.rule].filter(Boolean);
      const dedicated = [...special, wireCatalog, ...chatRules, ...(context.PHONE_INBOX?.rule ? [context.PHONE_INBOX.rule] : []), ...(context.PHONE_STORY?.rule ? [context.PHONE_STORY.rule] : []), messages.at(-1).content].join('\n');
      const all = messages.map(message => message.content).join('\n');
      rows.push({ scenario, stage, dedicatedChars: Array.from(dedicated).length, dedicatedTokenEstimate: estimateTokens(dedicated).estimatedTokens,
        totalChars: Array.from(all).length, totalTokenEstimate: estimateTokens(all).estimatedTokens });
    }
    if (stages.length === 3) {
      const sizes = rows.filter(row => row.scenario === scenario).map(row => row.dedicatedChars);
      exceeded ||= Math.max(...sizes) > 60_000;
      if (Math.max(...sizes) > Math.min(...sizes) * 1.2) warn(scenario + ' 三段专属字数差异超过 20%');
    }
  }
  log(JSON.stringify(rows, null, 2));
} finally { await server.close(); }
if (exceeded) process.exitCode = 1;
