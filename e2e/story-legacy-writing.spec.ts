import { expect, test } from './helpers/test';
import native from './fixtures/story-writing/v10-native.json' with { type: 'json' };
import preset from './fixtures/story-writing/v10-preset.json' with { type: 'json' };

for (const fixture of [native, preset]) {
  for (const selection of ['native', 'preset'] as const) {
    test(`V10 ${fixture.mode} 断点：确认 ${selection} 续写后保留未知前缀并完成结算`, async ({page}) => {
      const calls: string[] = [];
      const exerciseRewrite = fixture.mode === 'native' && selection === 'native';
      await page.route('**/legacy.mock.invalid/**', async route => {
        const wire = route.request().postData()!;
        calls.push(wire);
        if (exerciseRewrite && calls.length === 1) {
          await route.fulfill({json:{choices:[{message:{content:'无标签的失败响应'},finish_reason:'stop'}]}});
          return;
        }
        const firstContinuation = calls.length === (exerciseRewrite ? 2 : 1);
        const content = firstContinuation ? '旅客向站台走去，停在电车旁。'
          : '车门轻轻关上。</正文><短期记忆>候车后上车。</短期记忆><变量规划>[]</变量规划>';
        await route.fulfill({json:{choices:[{message:{content},finish_reason:firstContinuation ? 'length' : 'stop'}]}});
      });
      await page.goto('/');
      const initial = await page.evaluate(async ({draft, selection}) => {
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
          return {draft:await repo.loadDraft(state.saveId),turn:state.turnNumber};
        } finally { repo.close(); }
      }, {draft:fixture.draft,selection});
      expect(initial.draft.storyPartial).toEqual(fixture.draft.storyPartial);
      await page.goto('/#game/save-a');
      await page.reload();
      const partial = page.locator('.story-partial');
      const prefix = fixture.draft.storyPartial.text.replace('<正文>', '');
      await expect(partial).toContainText(prefix);
      await expect(partial).toContainText('文学来源未知');
      await expect(partial.getByRole('button',{name:'复制已写内容'})).toBeVisible();
      const resume = page.getByRole('button',{name:'续写正文',exact:true});
      await Promise.all([page.waitForEvent('dialog').then(async dialog => {
        expect(dialog.message()).toContain('旧版断点没有记录文学来源');
        await dialog.dismiss();
      }), resume.click()]);
      await expect(partial).toContainText(prefix);
      expect(calls).toHaveLength(0);
      if (exerciseRewrite) {
        await partial.getByRole('button',{name:'重新生成正文'}).click();
        await expect.poll(() => calls.length).toBe(1);
        await expect(resume).toBeEnabled();
        await expect(partial).toContainText(prefix);
        expect(calls[0]).not.toContain('【续写】');
      }
      await Promise.all([page.waitForEvent('dialog').then(async dialog => {
        expect(dialog.message()).toContain(selection === 'native' ? '王朝原生文学设置' : 'peinture-1118');
        await dialog.accept();
      }), resume.click()]);
      const read = () => page.evaluate(async () => {
        const {SaveRepository} = await import('/src/services/storage/saveRepository.ts' as string);
        const repo = await SaveRepository.open();
        try { return {draft:await repo.loadDraft('save-a'),state:await repo.load('save-a')}; } finally { repo.close(); }
      });
      await expect.poll(async () => (await read()).draft?.storyPartial?.writing).toMatchObject({source:selection,prefixSource:'unknown'});
      const interim = await read();
      expect(interim.state.turnNumber).toBe(initial.turn);
      expect(interim.draft.storyPartial.text).toContain(fixture.draft.storyPartial.text);
      expect(calls).toHaveLength(exerciseRewrite ? 2 : 1);
      if (selection === 'preset') {
        const digests = await page.evaluate(async () => {
          const [host,lib,ui] = await Promise.all(['/src/presets/tavern/hostState.ts','/src/presets/library.ts',
            '/src/presets/peintureSettings.ts'].map(p => import(p)));
          const selected = host.captureAssistantPreferences(), pack = await lib.resolveStoryPreset(selected);
          const id = pack.definition.id, current = host.readEditorOverride(id);
          const changed = ui.toggleEntry(pack,current ?? ui.emptyOverride(pack),'wave-length-dynamic-more',true);
          host.storeEditorOverride(id,current,changed);
          const different = await lib.captureStoryWriting(host.captureAssistantPreferences(),{});
          host.storeEditorOverride(id,changed,ui.toggleEntry(pack,changed,'wave-length-800-1000',true));
          return {different,restored:await lib.captureStoryWriting(host.captureAssistantPreferences(),{})};
        });
        expect(digests.different.configuration).not.toBe(interim.draft.storyPartial.writing.configuration);
        expect(digests.restored.configuration).toBe(interim.draft.storyPartial.writing.configuration);
      }
      await page.reload();
      await resume.click();
      await expect.poll(async () => (await read()).state.turnNumber).toBe(initial.turn + 1);
      const saved = (await read()).state.journal.at(-1).story.narrative;
      expect(saved).toBe(prefix + '旅客向站台走去，停在电车旁。车门轻轻关上。');
      expect(calls).toHaveLength(exerciseRewrite ? 3 : 2);
      for (const wire of calls.slice(exerciseRewrite ? 1 : 0)) expect(wire).toContain('【续写】');
    });
  }
}
