import { openWorldArchive } from './helpers/gameLayout';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';

async function seedSave(page: Page, npcs: Record<string, unknown>[]) {
  await page.goto('/');
  await page.evaluate(async (people) => {
    const fixturePath = '/src/tests/fixtures/game.ts', repoPath = '/src/services/storage/saveRepository.ts';
    const { game } = await import(fixturePath);
    const { SaveRepository } = await import(repoPath);
    const state = game();
    for (const person of people) state.npc[person.id as string] = person;
    const repo = await SaveRepository.open();
    await repo.create(state);
    repo.close();
  }, npcs);
  await page.reload();
  await openGameTools(page);
  await page.getByRole('button', { name: /读取存档/ }).click();
  await openGameTools(page);
}

function baseNpc(id: string, name: string, kind: 'ordinary' | 'special', gender?: string, age?: number) {
  const n: Record<string, unknown> = {
    id, identityKey: `k-${id}`, kind, name, aliases: [], skills: [],
    onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
  };
  if (kind === 'special') {
    n.detailedBackground = 'bg'; n.activeGoals = []; n.habits = [];
    n.longTermMemories = []; n.offscreenTaskIds = [];
  }
  if (gender) n.gender = gender;
  if (age !== undefined) n.age = age;
  return n;
}

test.describe('香闺秘档 UI', () => {
  test('资格显示与切换不残留', async ({ page }) => {
    const withProfile = baseNpc('f1', '有档案女', 'special', 'female', 22);
    withProfile.privateProfile = { chestDescription: '测试胸部', isVirgin: true };
    const emptyFemale = baseNpc('f2', '空档案女', 'special', 'female', 25);
    const ordinary = baseNpc('o1', '普通女', 'ordinary', 'female', 30);
    const male = baseNpc('m1', '特殊男', 'special', 'male', 28);
    const minor = baseNpc('y1', '未成年女', 'special', 'female', 16);

    await seedSave(page, [withProfile, emptyFemale, ordinary, male, minor]);

    await openWorldArchive(page); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /NPC/ }).click();
    const dialog = page.getByRole('dialog', { name: 'NPC', exact: true });

    // 有档案
    await dialog.getByRole('button', { name: /有档案女/ }).click();
    await expect(dialog.getByRole('heading', { name: '香闺秘档' })).toBeVisible();
    await expect(dialog.getByRole('definition').filter({ hasText: '测试胸部' }).first()).toBeVisible();

    // 空档案
    await dialog.getByRole('button', { name: /空档案女/ }).click();
    await expect(dialog.getByRole('heading', { name: '香闺秘档' })).toBeVisible();
    await expect(dialog.getByText('私密档案尚未建立')).toBeVisible();

    // 普通
    await dialog.getByRole('button', { name: /普通女/ }).click();
    await expect(dialog.getByText('香闺秘档')).not.toBeVisible();

    // 男性
    await dialog.getByRole('button', { name: /特殊男/ }).click();
    await expect(dialog.getByText('香闺秘档')).not.toBeVisible();

    // 未成年
    await dialog.getByRole('button', { name: /未成年女/ }).click();
    await expect(dialog.getByText('香闺秘档')).not.toBeVisible();

    // 切换后不残留
    await dialog.getByRole('button', { name: /有档案女/ }).click();
    await expect(dialog.getByRole('definition').filter({ hasText: '测试胸部' }).first()).toBeVisible();
    await dialog.getByRole('button', { name: /普通女/ }).click();
    await expect(dialog.getByText('测试胸部')).not.toBeVisible();

    // 关闭后重新打开
    await dialog.getByRole('button', { name: '关闭资料界面' }).click();
    await expect(dialog).toBeHidden();
    await openWorldArchive(page); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /NPC/ }).click();
    const reopened = page.getByRole('dialog', { name: 'NPC', exact: true });
    await reopened.getByRole('button', { name: /有档案女/ }).click();
    await expect(reopened.getByRole('heading', { name: '香闺秘档' })).toBeVisible();
    await expect(reopened.getByRole('definition').filter({ hasText: '测试胸部' }).first()).toBeVisible();
    await reopened.getByRole('button', { name: '关闭资料界面' }).click();

    // 刷新后仍与正式存档一致
    await page.reload();
    await openGameTools(page);
    await openWorldArchive(page); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /NPC/ }).click();
    const afterRefresh = page.getByRole('dialog', { name: 'NPC', exact: true });
    await afterRefresh.getByRole('button', { name: /有档案女/ }).click();
    await expect(afterRefresh.getByRole('heading', { name: '香闺秘档' })).toBeVisible();
    await expect(afterRefresh.getByRole('definition').filter({ hasText: '测试胸部' }).first()).toBeVisible();

    // 布局：无整体水平溢出，按钮可点，弹窗可关
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(overflow).toBe(true);
    await expect(afterRefresh.getByRole('button', { name: /有档案女/ })).toBeEnabled();
    await afterRefresh.getByRole('button', { name: '关闭资料界面' }).click();
    await expect(afterRefresh).toBeHidden();
  });
});
