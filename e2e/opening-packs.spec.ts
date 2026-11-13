import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import type { Creation } from '../src/ui/creation/model';
import type { OpeningPack } from '../src/ui/creation/openingPacks';
import { chooseCustomProfession, chooseProfession, mobileCreation, showPersonalSkills, showCreationReview } from './helpers/creation';
import { goHome } from './helpers/gameLayout';

const draft = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.creation.v1')!) as Creation);
const packs = (page: Page) => page.evaluate(() => Object.keys(localStorage)
  .filter(key => key.startsWith('heijin.opening-pack.v1:')).map(key => JSON.parse(localStorage.getItem(key)!) as OpeningPack));
async function saves(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.list(); } finally { repo.close(); }
  });
}
async function seeded(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const modelPath = '/src/ui/creation/model.ts', packPath = '/src/ui/creation/openingPacks.ts';
    const { newCreation } = await import(modelPath), { OpeningPackStore } = await import(packPath);
    const form = newCreation();
    Object.assign(form, { person: { name: '林岚', age: '29', gender: '女性', appearance: '衣着素净', personality: '谨慎' },
      customProfession: '修复师', skills: '修补\n记录', skillsSource: 'manual', background: '原始背景', openingPreference: '2008年秋天' });
    const store = new OpeningPackStore(localStorage); store.save('城市生活', form); store.save('城市生活', form);
    localStorage.setItem('heijin.creation.v1', JSON.stringify(form));
  });
  await page.reload(); await page.getByRole('button', { name: /开始新游戏/ }).click();
}

test('完整五步保存、再次套用直达第五步、编辑刷新与正式建档隔离', async ({ page }, info) => {
  const requests: string[] = [];
  await page.route('https://**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/'); await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林岚');
  await page.getByLabel('年龄', { exact: true }).fill('29');
  await page.getByRole('radio', { name: '女性', exact: true }).check();
  await page.getByLabel('外貌', { exact: true }).fill('  衣着素净\n手上有淡淡的墨痕。  ');
  await page.getByLabel('性格', { exact: true }).fill('认真\n偶尔冲动');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByLabel('职业名称', { exact: true }).fill('旧书修复师');
  await page.getByLabel('职业介绍', { exact: true }).fill('修复纸本\n保存社区档案');
  await page.getByLabel('内置职业技能', { exact: true }).fill('修复\n\n  手写记录  ');
  await page.getByLabel('长期影响', { exact: true }).fill('长期与社区合作\n保持独立');
  await page.getByRole('button', { name: '技术与生产', exact: true }).click();
  await chooseProfession(page, '程序员');
  await showPersonalSkills(page);
  await page.getByLabel('个人技能与专长').fill('手工编程\n记录工作');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /上海/ }).check();
  const background = '  成长经历\n' + '家庭、求学与工作经历。\n'.repeat(100) + '背景末行  ';
  await page.getByLabel('人物背景（可选）').fill(background);
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('checkbox', { name: '创建一名初始同伴' }).check();
  for (const [label, value] of Object.entries({ 同伴姓名: '许宁', '同伴年龄（可选）': '28', 同伴身份: '同事',
    与主角的关系: '相识多年的朋友', 同伴外貌: '短发', 同伴性格: '直率', '同伴能力（一行一项）': '排版\n沟通', 同伴个人经历: '少年在外地读书\n后来回城' })) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: /下一步/ }).click();
  const preference = '  2008年秋天\n' + '从普通的一天开始，不改写已有家庭设定。\n'.repeat(100) + '偏好末行  ';
  await page.getByLabel('开局偏好（可选）').fill(preference);
  const original = await draft(page);
  await page.getByRole('button', { name: '保存为开局包', exact: true }).click();
  await page.getByLabel('开局包名称').fill('上海普通人生');
  await page.getByRole('button', { name: '保存开局包', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('开局包已保存');
  expect(await saves(page)).toEqual([]); expect((await draft(page)).step).toBe(5);
  const originalPacks = await packs(page);
  await page.getByRole('button', { name: mobileCreation(page) ? '‹ 首页' : '返回首页', exact: true }).click();
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByRole('navigation', { name: '角色创建步骤' }).getByRole('button', { name: /基本信息/ }).click();
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await page.getByRole('radio', { name: /上海普通人生/ }).check();
  await page.screenshot({ path: `docs/opening-packs/screenshots/${info.project.name}-select.png`, fullPage: true });
  await page.getByRole('button', { name: '套用开局包', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将替换当前创角草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await draft(page)).toMatchObject({ saveId: original.saveId, step: 1 });
  await page.getByRole('button', { name: '套用开局包', exact: true }).click();
  await page.getByRole('button', { name: '确认替换并套用' }).click();
  const applied = await draft(page);
  expect(applied).toEqual({ ...original, saveId: applied.saveId });
  expect(applied.saveId).not.toBe(original.saveId);
  await expect(page.getByRole('heading', { name: '确认与开局', exact: true })).toBeVisible();
  await expect(page.getByLabel('开局偏好（可选）')).toHaveValue(preference);
  await showCreationReview(page);
  await page.getByText('完整职业表单', { exact: true }).click();
  await expect(page.getByRole('region', { name: '保留的自定义职业' })).toContainText('旧书修复师');
  await expect(page.locator('.creation-review')).toContainText('背景末行');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/opening-packs/screenshots/${info.project.name}-review.png`, fullPage: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `docs/opening-packs/screenshots/${info.project.name}-review-viewport.png` });
  await page.getByRole('button', { name: '修改职业', exact: true }).click();
  await chooseCustomProfession(page);
  await expect(page.getByLabel('内置职业技能')).toHaveValue(original.customProfile!.skills);
  await page.getByLabel('内置职业技能').fill('新编辑技能\n修补');
  await page.getByRole('button', { name: '确认与开局', exact: false }).click();
  await page.reload();
  expect(await draft(page)).toMatchObject({ saveId: applied.saveId, step: 5, skills: '新编辑技能\n修补', background, openingPreference: preference });
  expect(await packs(page)).toEqual(originalPacks); expect(await saves(page)).toEqual([]);
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.locator('.game-layout')).toBeVisible();
  expect(await saves(page)).toHaveLength(1);
  const saved = await page.evaluate(async id => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return { state: await repo.load(id), draft: await repo.loadDraft(id) }; } finally { repo.close(); }
  }, applied.saveId);
  expect(saved.state.protagonist).toMatchObject({ name: original.person.name, background, skills: ['新编辑技能', '修补'] });
  expect(saved.state.npc.companion).toMatchObject({ name: '许宁', background: original.companion.background });
  expect(saved.draft.userInput).toBe(preference); expect(await packs(page)).toEqual(originalPacks);
  // Without AI configuration, the existing mobile diagnostics sheet reports a safe stop.
  // Close that real modal before using the external game menu; never bypass it with force.
  if (mobileCreation(page)) {
    const diagnostics = page.locator('.mobile-diagnostics-sheet');
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toContainText('错误码：configuration');
    await page.keyboard.press('Escape');
    await expect(diagnostics).not.toBeVisible();
  }
  // After the original creation flow finishes, the next new character starts at step 1.
  await goHome(page);
  if (mobileCreation(page)) {
    await page.getByRole('navigation', { name: '车票页码' }).getByRole('button', { name: /空白车票/ }).click();
    await page.getByRole('button', { name: /开始新游戏/ }).click();
  }
  else await page.locator('.library .dossier.new button').click();
  expect((await draft(page)).step).toBe(1);
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await page.getByRole('radio', { name: /上海普通人生/ }).check();
  await page.getByRole('button', { name: '套用开局包', exact: true }).click();
  await page.getByRole('button', { name: '确认替换并套用' }).click();
  const fresh = await draft(page);
  expect(fresh).toEqual({ ...original, saveId: fresh.saveId });
  expect(fresh.saveId).not.toBe(applied.saveId); expect(await saves(page)).toHaveLength(1);
  expect(await packs(page)).toEqual(originalPacks);
  expect(requests).toEqual([]);
});

test('同名包独立管理：重命名、取消删除、明确覆盖及确认删除', async ({ page }) => {
  await seeded(page); const original = await packs(page);
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(2);
  const choices = page.getByRole('dialog').getByRole('radio');
  await choices.first().check(); await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('开局包名称').fill('重命名包'); await page.getByRole('button', { name: '确认重命名' }).click();
  await expect(page.getByRole('dialog')).toContainText('重命名包');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click(); expect(await packs(page)).toHaveLength(2);
  await page.getByRole('button', { name: '关闭开局包' }).click();
  await page.getByRole('button', { name: '确认与开局', exact: false }).click();
  await page.getByLabel('开局偏好（可选）').fill('新的偏好');
  await page.getByRole('button', { name: '保存为开局包', exact: true }).click();
  if (mobileCreation(page)) await page.getByRole('radiogroup', { name: '保存方式' }).getByRole('radio', { name: '覆盖：重命名包', exact: true }).click();
  else await page.getByLabel('保存方式').selectOption(original[0].id);
  await page.getByRole('button', { name: '保存开局包', exact: true }).click();
  expect((await packs(page))[0].settings.openingPreference).toBe(original[0].settings.openingPreference);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '保存开局包', exact: true }).click();
  await page.getByRole('button', { name: '确认覆盖' }).click();
  const updated = await packs(page);
  expect(updated[0]).toMatchObject({ id: original[0].id, name: '重命名包', settings: { openingPreference: '新的偏好' } });
  expect(updated[1]).toEqual(original[1]);
  await page.getByRole('navigation', { name: '角色创建步骤' }).getByRole('button', { name: /基本信息/ }).click();
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await page.getByRole('radio', { name: /重命名包/ }).check();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不可撤销');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('button', { name: '关闭开局包' }).click(); await page.reload();
  expect(await packs(page)).toEqual([original[1]]); expect(await saves(page)).toEqual([]);
});

test('损坏包隔离，存储拒绝不误报成功、不丢失有效包或当前草稿', async ({ page }) => {
  await seeded(page); const before = await packs(page), original = await draft(page);
  await page.evaluate(() => localStorage.setItem('heijin.opening-pack.v1:broken', '{'));
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1 份开局包无法读取');
  await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭开局包' }).click();
  await page.getByRole('button', { name: '确认与开局', exact: false }).click();
  await page.getByRole('button', { name: '保存为开局包', exact: true }).click();
  await page.getByLabel('开局包名称').fill('不能保存');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('heijin.opening-pack.v1:')) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存开局包', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('操作未完成');
  await expect(page.getByText('开局包已保存', { exact: true })).toHaveCount(0);
  expect(await draft(page)).toEqual({ ...original, step: 5 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('heijin.opening-pack.v1:')).length)).toBe(3);
  await page.getByRole('button', { name: '关闭开局包' }).click(); await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('heijin.opening-pack.v1:broken'))).toBe('{');
  const valid = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('heijin.opening-pack.v1:') && !key.endsWith(':broken')).map(key => JSON.parse(localStorage.getItem(key)!)));
  expect(valid).toEqual(before); expect(await saves(page)).toEqual([]);
});

test('读取被拒绝时明确反馈，恢复权限后仍可查看有效包', async ({ page }) => {
  await seeded(page);
  await page.evaluate(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key.startsWith('heijin.opening-pack.v1:')) throw new DOMException('denied', 'SecurityError');
      return original.call(this, key);
    };
  });
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await expect(page.locator('.opening-packs').getByRole('alert')).toContainText('操作未完成');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(2);
});
