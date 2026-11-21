import { test, expect } from './helpers/test';
import { openGameTools, openSettings } from './helpers/gameLayout';
import type { Page } from '@playwright/test';
import type { AiMessage } from '../src/services/ai/protocols';

const action = '去水塔找值班员';
const note = '玻璃徽章属于值班员，{{user}} 保留原样。';
const narrative = '林舟在水塔找到值班员，记下玻璃徽章的来历。';
const file = Buffer.from(JSON.stringify({ name: '水塔档案', entries: {
  '1': { uid: 1, key: ['水塔'], content: note },
  '2': { uid: 2, key: ['PRIVATE_FIXTURE'], content: '私人词不应使条目触发' },
  '3': { uid: 3, key: ['水塔'], position: 7, outletName: 'hidden', content: 'Outlet 不应出站' },
} }));

async function openWorldbooks(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^世界书/ }).click();
  await expect(page.getByRole('button', { name: '导入世界书', exact: true })).toBeVisible();
}

test('实际导入世界书后仅公开行动触发，关闭后另一存档的 Story 不再发送资料', async ({ page }) => {
  test.setTimeout(60_000);
  const sent: AiMessage[][] = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'worldbook-story.mock.invalid') {
      sent.push(route.request().postDataJSON().messages);
      return route.fulfill({ json: { choices: [{ message: {
        content: '<正文>' + narrative + '</正文><短期记忆>找到水塔值班员。</短期记忆>',
      }, finish_reason: 'stop' }] } });
    }
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto('/');
  await page.evaluate(async action => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/game.ts', '/src/domain/drafts.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { game }, { createTurnDraft }, { defaultSettings, settingsKey },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const config = defaultAiConfig(), channel = { ...newChannel(), baseUrl: 'https://worldbook-story.mock.invalid/v1', defaultModel: 'mock' };
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'mock' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-worldbook-key');

    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    settings.runtime.streamStory = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const repository = await SaveRepository.open();
    try {
      for (const saveId of ['worldbook-story-a', 'worldbook-story-b']) {
        const state = game(saveId);
        state.protagonist.background = 'PRIVATE_FIXTURE';
        await repository.create(state);
        await repository.saveDraft(createTurnDraft(saveId, 0, 'opening-' + saveId, 'opening', action), null);
      }
    } finally { repository.close(); }
  }, action);
  await page.reload();
  await openWorldbooks(page);
  await expect(page.getByText(/启用的世界书暂时不会带入正文/)).toHaveCount(0);
  await page.getByLabel('选择世界书文件').setInputFiles({ name: 'water-tower.json', mimeType: 'application/json', buffer: file });
  await expect(page.getByText(/已导入「水塔档案」/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '启用整本「水塔档案」', exact: true })).toBeChecked();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭资料界面' }).click();
  await page.reload();
  expect(sent).toHaveLength(0);

  async function generate(saveId: string) {
    await page.goto('/#game/' + saveId);
    await openGameTools(page, true);
    await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
    await expect.poll(() => page.evaluate(async id => {
      const path = '/src/services/storage/saveRepository.ts';
      const { SaveRepository } = await import(path), repository = await SaveRepository.open();
      try {
        const { state, draft } = await repository.loadGame(id);
        return { narrative: draft?.story?.narrative, revision: state.revision };
      } finally { repository.close(); }
    }, saveId)).toEqual({ narrative, revision: 0 });
  }

  await generate('worldbook-story-a');
  expect(sent).toHaveLength(1);
  const messages = sent[0], index = messages.findIndex(m => m.content.startsWith('<PLAYER_WORLDBOOK>'));
  expect(index).toBeGreaterThan(0);
  expect(messages.slice(index).some(m => m.role === 'system')).toBe(false);
  expect(messages[index]).toMatchObject({ role: 'user', content: expect.stringContaining(note) });
  expect(messages[index].content).not.toMatch(/私人词不应使条目触发|Outlet 不应出站/);

  await page.goto('/');
  await openWorldbooks(page);
  const enabled = page.getByRole('checkbox', { name: '启用「水塔档案」', exact: true });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭资料界面' }).click();
  await generate('worldbook-story-b');
  expect(sent).toHaveLength(2);
  expect(sent[1].some(m => m.content.includes('PLAYER_WORLDBOOK'))).toBe(false);
});
