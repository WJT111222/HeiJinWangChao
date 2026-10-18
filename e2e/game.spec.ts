import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts';
    const fixturePath = '/src/tests/fixtures/ui.ts';
    const { SaveRepository } = await import(repoPath);
    const { uiFixture } = await import(fixturePath);
    const repo = await SaveRepository.open();
    repo.close();
    // 隔离浏览器上下文中的界面测试数据，生产代码无此入口。
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('heijinwangchao', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('saves', 'readwrite');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
        tx.objectStore('saves').put(uiFixture());
      };
    });
  });
  await page.reload();
}
async function begin(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill(name);
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByLabel('性别', { exact: true }).fill('女');
  await page.getByLabel('外貌', { exact: true }).fill('短发');
  await page.getByLabel('性格', { exact: true }).fill('沉稳');
  await page.getByRole('button', { name: /下一步/ }).click();
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try {
      const [summary] = await repo.list();
      return {
        state: await repo.load(summary.saveId),
        draft: await repo.loadDraft(summary.saveId),
      };
    } finally {
      repo.close();
    }
  });
}
test('五步完整创建、返回修改及刷新恢复，保存特殊同伴和开局偏好', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await begin(page, '林舟');
  await expect(page.getByRole('radio')).toHaveCount(17);
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByLabel('个人技能与专长').fill('我填写的技能\n沟通');
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByLabel('人物背景（可选）').fill('已婚，有明确家庭经历，不应被覆盖。');
  for (const city of ['上海', '哈尔滨', '广州', '重庆']) {
    await page.getByRole('radio', { name: new RegExp(city) }).check();
    await expect(page.getByLabel('人物背景（可选）')).toHaveValue(
      '已婚，有明确家庭经历，不应被覆盖。',
    );
  }
  await page.reload();
  await expect(page.getByLabel('人物背景（可选）')).toHaveValue(
    '已婚，有明确家庭经历，不应被覆盖。',
  );
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.getByLabel('个人技能与专长')).toHaveValue('我填写的技能\n沟通');
  await page.getByRole('radio', { name: /^律师/ }).check();
  await expect(page.getByLabel('个人技能与专长')).toHaveValue('我填写的技能\n沟通');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByLabel('创建一名初始同伴').check();
  for (const [label, value] of Object.entries({
    同伴姓名: '陈宁',
    '同伴年龄（可选）': '29',
    同伴身份: '记者',
    同伴外貌: '戴眼镜',
    同伴性格: '耐心',
    '同伴能力（一行一项）': '采访',
    同伴个人经历: '大学时期相识',
    与主角的关系: '多年朋友',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.getByText('大学时期相识', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改基本信息' }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('林舟');
  await page.getByRole('button', { name: /确认与开局/ }).click();
  await page.getByLabel('开局偏好（可选）').fill('从日常工作开始。');
  await page.getByRole('button', { name: '确认并创建存档' }).click();
  await expect(page.getByRole('heading', { name: '故事，尚未落笔。' })).toBeVisible();
  await expect(page.getByRole('button', { name: /生成开局/ })).toBeDisabled();
  const { state, draft } = await readSave(page);
  expect(state.economy.cash).toBeNull();
  expect(state.economy.onlineBalance).toBeNull();
  expect(state.items).toEqual({});
  expect(state.journal).toEqual([]);
  expect(state.npc.companion.kind).toBe('special');
  expect(state.npc.companion.background).toBe('大学时期相识');
  expect(draft.userInput).toBe('从日常工作开始。');
  expect(draft.story).toBeUndefined();
  await page.reload();
  await expect(page.getByRole('heading', { name: '林舟' })).toBeVisible();
  const sidebar = page.getByRole('complementary', { name: '主角信息' });
  await expect(sidebar).toContainText('未确认');
  await expect(sidebar).not.toContainText('0.00 元');
  await expect(sidebar.locator('.detail').filter({ hasText: '主武器' })).toContainText('无');
  const workflow = await page.getByRole('region', { name: '三阶段工作流' }).boundingBox();
  const input = await page.getByLabel('你的行动').boundingBox();
  expect(workflow!.y).toBeLessThan(input!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('自定义职业、跳过同伴，多存档选择切换与确认删除', async ({ page }) => {
  await seed(page);
  await begin(page, '自定义角色');
  await page.getByRole('radio', { name: /^自定义职业/ }).check();
  await page.getByLabel('自定义职业名称').fill('独立策展人');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await page.getByRole('button', { name: '确认并创建存档' }).click();
  await expect(page.getByRole('heading', { name: '自定义角色' })).toBeVisible();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await expect(page.locator('.save-card')).toHaveCount(2);
  const first = page.locator('.save-card').filter({ hasText: '界面测试存档（隔离）' });
  await first.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await expect(page.getByText('这是隔离测试用正文。').first()).toBeVisible();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await page
    .locator('.save-card')
    .filter({ hasText: '自定义角色' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.save-card')).toHaveCount(2);
  await page
    .locator('.save-card')
    .filter({ hasText: '自定义角色' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.locator('.save-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.save-card')).toHaveCount(1);
});
test('七面板一键打开、键盘关闭、保留阅读位置并隔离秘密资料', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: /读取存档/ }).click();
  const reader = page.getByTestId('story-reader');
  await reader.evaluate((el) => {
    el.scrollTop = 500;
  });
  const position = await reader.evaluate((el) => el.scrollTop);
  for (const title of ['NPC', '势力组织', '地图', '物品栏', '世界事件', '历史时间轴', '记忆']) {
    const opener = page
      .getByRole('complementary', { name: '世界资料' })
      .getByRole('button', { name: new RegExp(title) });
    await opener.click();
    const modal = page.getByRole('dialog', { name: title, exact: true });
    await expect(modal).toBeVisible();
    await expect(modal).not.toContainText('不可见');
    if (title === 'NPC') {
      await page.getByLabel('搜索人物').fill('同事');
      await page.getByRole('button', { name: /同事/ }).click();
      await expect(modal).toContainText('工作中相互信任');
    }
    if (title === '历史时间轴')
      expect(await modal.locator('li h3').allTextContents()).toEqual([
        '更早的公开事件',
        '公开会面',
      ]);
    if (title === '记忆') await expect(modal).toContainText('已知记忆：一次公开会面');
    await page.keyboard.press('Tab');
    expect(await modal.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await reader.evaluate((el) => el.scrollTop)).toBe(position);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('四类设置可键盘操作、保存恢复，七项提示词与两个运行开关独立', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5174')) external.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('API 密钥')).toBeDisabled();
  await expect(page.getByRole('button', { name: /测试连接/ })).toBeDisabled();
  await page.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(page.locator('.settings-fields > label')).toHaveCount(7);
  await page.getByLabel('叙事人称').selectOption('first');
  await page.getByLabel('正文最低字数').fill('2000');
  await page.getByLabel('NoControl（防抢话）').uncheck();
  await page.getByRole('button', { name: '保存本地设置' }).click();
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await page.getByLabel('即时记忆完整回合数').fill('0');
  await page.getByRole('button', { name: '保存本地设置' }).click();
  await expect(page.getByRole('status')).toContainText('正整数');
  await page.getByLabel('即时记忆完整回合数').fill('12');
  await page.getByRole('button', { name: '保存本地设置' }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await expect(page.getByLabel('动态世界', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存本地设置' }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(page.getByLabel('叙事人称')).toHaveValue('first');
  await expect(page.getByLabel('正文最低字数')).toHaveValue('2000');
  await expect(page.getByLabel('NoControl（防抢话）')).not.toBeChecked();
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(page.getByLabel('即时记忆完整回合数')).toHaveValue('12');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.getByLabel('变量管理', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('动态世界', { exact: true })).toBeChecked();
  expect(external).toEqual([]);
});
