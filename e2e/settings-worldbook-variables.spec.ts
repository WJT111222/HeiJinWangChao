import { expect, test } from './helpers/test';
import { openGameTools, openSettings } from './helpers/gameLayout';
import { seedSummary, summaryState } from './helpers/memorySummary';
import type { AiMessage } from '../src/services/ai/protocols';

const action = '我去水塔跟晚晴会合。';
const savedEntry = '水塔管理员把备用钥匙放在蓝盒里。{{user}}';
const narrative = '晚晴来到水塔，把蓝盒交给你。';
const book = { name: '水塔值班档案', entries: {
  '0': { uid: 0, key: ['水塔'], comment: '备用钥匙', content: '备用钥匙的存放位置待核实。' },
} };

test('世界书与变量设置保护未保存修改，保存后同时进入下一次正文请求', async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  const sent: { model: string; messages: AiMessage[] }[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'summary.mock.invalid' && route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ json: { choices: [{ message: {
        content: `<正文>${narrative}</正文><短期记忆>晚晴在水塔交付了蓝盒。</短期记忆><变量规划>[]</变量规划>`,
      }, finish_reason: 'stop' }] } });
    }
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? route.continue() : route.abort();
  });
  await seedSummary(page, { count: 3, npcCount: 2, automatic: false });
  await page.evaluate(async action => {
    const modelPath = '/src/ui/settings/model.ts', repoPath = '/src/services/storage/saveRepository.ts', draftsPath = '/src/domain/drafts.ts';
    const { settingsKey } = await import(modelPath);
    const { SaveRepository } = await import(repoPath), { createTurnDraft } = await import(draftsPath);
    const settings = JSON.parse(localStorage.getItem(settingsKey)!);
    settings.runtime.streamStory = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const repo = await SaveRepository.open();
    try {
      const { state } = await repo.loadGame('save-a');
      await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'worldbook-variable-turn', 'regular', action), null);
    } finally { repo.close(); }
  }, action);
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
  const before = await summaryState(page);
  await openSettings(page);
  const panel = page.getByRole('dialog', { name: '设置', exact: true });
  const category = (name: string) => panel.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
  const close = () => panel.getByRole('button', { name: '关闭资料界面' }).click();
  const back = () => panel.getByRole('button', { name: '返回设置', exact: true }).click();
  const shot = async (name: string) => {
    const path = info.outputPath(`${name}.jpg`);
    await page.screenshot({ path, quality: 85 });
    await info.attach(name, { path, contentType: 'image/jpeg' });
  };
  const resume = async (name: string) => {
    const warning = page.getByRole('dialog', { name, exact: true });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '继续编辑', exact: true }).first().click();
  };

  await expect(category('世界书')).toBeVisible();
  await expect(category('变量管理')).toBeVisible();
  await shot('settings-entries');
  await category('世界书').click();
  await expect(panel.getByRole('button', { name: '导入世界书', exact: true })).toBeVisible();
  await panel.getByLabel('选择世界书文件').setInputFiles({ name: 'water-tower.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
  const enabled = panel.getByRole('checkbox', { name: '启用整本「水塔值班档案」', exact: true });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  const entry = panel.locator('.wb-entry').filter({ hasText: '备用钥匙' });
  await entry.locator('.wb-entry-title').click();
  const entryText = entry.getByRole('textbox', { name: '内容' });
  await entryText.fill(savedEntry);
  await expect(panel.getByText('有 1 项修改未保存')).toBeVisible();
  await shot('worldbook-edit');

  if (isMobile) await back(); else await category('变量管理').click();
  await resume('世界书尚未保存');
  await expect(entryText).toHaveValue(savedEntry);
  await close();
  await resume('世界书尚未保存');
  await expect(entryText).toHaveValue(savedEntry);
  await panel.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(panel.getByText(/已保存修改/)).toBeVisible();
  await expect(panel.getByText('有 1 项修改未保存')).toHaveCount(0);

  await entry.locator('.wb-entry-title').click();
  await expect(entryText).toHaveValue(savedEntry);
  await entryText.fill('尚未保存的条目改动。');
  await expect(panel.getByText('有 1 项修改未保存')).toBeVisible();
  if (isMobile) await back(); else await category('变量管理').click();
  await page.getByRole('dialog', { name: '世界书尚未保存', exact: true })
    .getByRole('button', { name: '放弃本次修改', exact: true }).click();
  if (isMobile) await category('变量管理').click();
  const domains = panel.getByRole('navigation', { name: '变量分区' });
  await expect(domains.getByRole('button')).toHaveCount(9);
  await panel.getByRole('button', { name: '路径修订', exact: true }).click();
  const addressing = { playerToNpc: '晚晴', npcToPlayer: '老大' };
  await panel.getByLabel('变量路径').fill('/npc/npc-a/addressing');
  await panel.getByLabel('变量值（JSON）').fill(JSON.stringify(addressing));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  const difference = panel.getByLabel('修改差异');
  await expect(difference).toContainText('/npc/npc-a/addressing');
  await difference.scrollIntoViewIfNeeded();
  await shot('variable-edit');

  if (isMobile) await back(); else await panel.getByRole('button', { name: /返回设置分类/ }).click();
  await resume('存档变量尚未保存');
  await expect(difference).toContainText('晚晴');
  await panel.getByRole('button', { name: '保存变量修改' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await close();
  await expect(panel).toHaveCount(0);
  const updated = await summaryState(page);
  expect(updated.npc['npc-a'].addressing).toEqual(addressing);
  expect(updated.journal).toEqual(before.journal);
  expect(sent).toHaveLength(0);

  await openGameTools(page);
  await page.getByRole('button', { name: '生成本回合正文', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  const [{ model, messages }] = sent;
  expect(model).toBe('story');
  const context = messages.find(message => message.content.startsWith('<GAME_CONTEXT>'))!;
  const json = JSON.parse(context.content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length));
  expect(json.PLAYER_ACTION).toBe(action);
  expect(json.SAVE_STATE.npc['npc-a'].addressing).toEqual(addressing);
  expect(messages.find(message => message.content.startsWith('<PLAYER_WORLDBOOK>'))).toMatchObject({
    role: 'user', content: expect.stringContaining(savedEntry),
  });
  await expect.poll(() => page.evaluate(async () => {
    const repositoryPath = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(repositoryPath);
    const repo = await SaveRepository.open();
    try { return (await repo.loadGame('save-a')).draft?.story?.narrative; }
    finally { repo.close(); }
  })).toBe(narrative);
  expect(await summaryState(page)).toEqual(updated);
  expect(sent).toHaveLength(1);

  await page.goto('/');
  await openSettings(page);
  await expect(category('世界书')).toBeVisible();
  await expect(category('变量管理')).toHaveCount(0);
  await category('世界书').click();
  await panel.getByRole('button', { name: /^水塔值班档案/ }).click();
  await panel.getByRole('button', { name: '删除整本', exact: true }).click();
  await panel.getByRole('button', { name: '取消', exact: true }).click();
  await expect(enabled).toBeChecked();
  await panel.getByRole('button', { name: '删除整本', exact: true }).click();
  await panel.getByRole('button', { name: '确认删除整本', exact: true }).click();
  await expect(panel.getByText('已删除「水塔值班档案」。')).toBeVisible();
  expect(sent).toHaveLength(1);
});
