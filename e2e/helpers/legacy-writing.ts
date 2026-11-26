import type { Page } from '@playwright/test';
import type preset from '../fixtures/story-writing/v10-preset.json';

export async function seedLegacyWriting(page: Page, draft: typeof preset.draft, selection: 'native' | 'preset', secondSave = false) {
  await page.goto('/');
  return page.evaluate(async ({draft, selection, secondSave}) => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/talentPrompt.ts','/src/ui/settings/model.ts',
      '/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/presets/settings.ts'];
    const [{SaveRepository},{talentPromptInput},{settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault},{savePresetSettings}]
      = await Promise.all(paths.map(p => import(p)));
    const {state,settings} = talentPromptInput('story','regular');
    settings.runtime.streamStory = false;
    settings.runtime.useWorldStage = false;
    settings.runtime.useVariableStage = false;
    settings.prompts.actionOptions = false;
    settings.prompts.minNarrativeChars = 5;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    savePresetSettings({enabled:selection === 'preset',selected:'peinture-1118',packages:{}});
    const channel = newChannel('openai'), config = defaultAiConfig();
    channel.baseUrl = 'https://legacy.mock.invalid/v1';
    channel.defaultModel = 'legacy-fixture';
    config.channels = [channel]; config.routes.story = {channelId:channel.id,modelId:''};
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage,localStorage).set(channel.id,'fixture-only');
    const repo = await SaveRepository.open();
    try {
      const pack = {state,draft};
      await repo.importBackup(pack,(await repo.compareBackup(pack)).confirmation);
      if (secondSave) {
        const other = {state:{...state,saveId:'save-b'},draft:{...draft,saveId:'save-b',turnId:'other-turn',
          storyPartial:{...draft.storyPartial,text:'<正文>乙档在桥头等车。'}}};
        await repo.importBackup(other,(await repo.compareBackup(other)).confirmation);
      }
      return {draft:await repo.loadDraft(state.saveId),turn:state.turnNumber};
    } finally { repo.close(); }
  }, {draft,selection,secondSave});
}
