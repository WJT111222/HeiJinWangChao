import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openWorkflow } from './helpers/gameLayout';

const cloud = readFileSync(new URL('../announcements/current.json', import.meta.url), 'utf8');
const approved = readFileSync(new URL('../src/tests/fixtures/disclaimer-v1.md', import.meta.url), 'utf8');
const privacy = approved.split('### 四、个人信息与数据安全\n\n')[1].split('\n\n### 五、')[0].trim().split('\n\n');
let posts = 0;
test.beforeEach(async ({ context }) => {
  posts = 0;
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') { posts++; return route.abort('blockedbyclient'); }
    if (route.request().url().endsWith('/api/announcement')) return route.fulfill({ status: 200, contentType: 'application/json', body: cloud, headers: { 'X-Announcement-Source': 'kv' } });
    return route.continue();
  });
});
test.afterEach(() => expect(posts).toBe(0));
async function mute(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const now = new Date();
    localStorage.setItem('heijin.notices.hidden-on.v1', [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'));
  });
}

test('中性须知第四章与云端公告：保留六章、完整隐私提醒、11条更新及本地备份告知', async ({ page }, info) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: '黑金王朝 · 游玩须知与免责声明', exact: true });
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(6);
  for (const paragraph of privacy) await expect(dialog.getByLabel('免责声明内容')).toContainText(paragraph);
  await expect(dialog).not.toContainText('允许玩家自行配置');
  await expect(dialog).not.toContainText('第三方 AI 服务与费用');
  if (info.project.name === 'mobile') {
    const nav = dialog.getByRole('navigation', { name: '须知章节' });
    await nav.getByRole('button', { name: /个人信息与数据安全/ }).click();
    await expect(nav.getByRole('button', { name: /个人信息与数据安全/ })).toHaveAttribute('aria-current','true');
  } else await dialog.getByRole('heading', { name: '四、个人信息与数据安全' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('privacy.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭免责声明' }).click();
  const notice = page.getByRole('dialog', { name: '王朝公告', exact: true });
  await expect(notice.getByRole('listitem')).toHaveCount(11);
  await expect(notice).toContainText('请妥善保管并备份重要游戏数据。');
  await expect(notice).not.toContainText('服务商收取');
  await expect(notice).not.toContainText('收费的第三方');
  await notice.getByRole('listitem').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('announcement.png'), animations: 'disabled' });
});

test('五站创角与模型设置：中性费用提示、技术字段及密钥安全仍完整', async ({ page }, info) => {
  await mute(page); await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/ui/creation/model.ts', { newCreation } = await import(path);
    const form = newCreation();
    form.person = { name: '沈砚', age: '27', gender: '男性', appearance: '衣着素净', personality: '沉稳谨慎' };
    form.customProfession = '旧书修复师'; form.skills = '修补\n记录'; form.skillsSource = 'manual';
    form.openingPreference = '从旧书店开始。';
    localStorage.setItem('heijin.creation.v1', JSON.stringify(form));
  });
  await page.goto('/#create'); await page.reload();
  const steps = ['基本信息','职业与能力','城市与背景','初始同伴','确认与开局'];
  for (let i=0;i<steps.length;i++) {
    await page.getByRole('navigation', { name: '角色创建步骤' }).getByRole('button', { name: new RegExp(`${steps[i]}$`) }).click();
    await expect(page.locator('.creation-card')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`creation-step${i+1}.png`), animations: 'disabled' });
  }
  await expect(page.locator('#opening-generation-notice')).toContainText('生成可能产生费用');
  await expect(page.locator('#opening-generation-notice')).toContainText('未配置 AI 时会安全停止');
  if (info.project.name === 'mobile') {
    await expect(page.locator('.creation-ticket-stub')).toContainText('生成可能产生费用');
    await expect(page.locator('.wizard-footer')).toContainText('生成可能产生费用');
  }
  await page.locator('#opening-generation-notice').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('creation-fee.png'), animations: 'disabled' });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 连接', exact: true }).click();
  await settings.getByRole('button', { name: '新增渠道', exact: true }).click();
  await expect(settings.getByLabel('API Base URL', { exact: true })).toBeVisible();
  const key = settings.getByLabel('API 密钥', { exact: true });
  await expect(key).toHaveAttribute('type','password'); await expect(key).toHaveValue('');
  await settings.getByText('浏览器会直接连接你填写的服务地址', { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-settings-security.png'), animations: 'disabled' });
  await expect(settings).toContainText('浏览器存储不是安全密钥库');
  await expect(settings).toContainText('密钥不进入游戏存档、提示词或诊断详情');
  await expect(settings).toContainText('测试连接会调用模型，可能产生费用');
  await settings.getByRole('button', { name: '测试连接（可能产生费用）', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-settings.png'), animations: 'disabled' });
});

test('游戏工作流保留中性费用提醒，纯浏览不写入正式状态或草稿', async ({ page }, info) => {
  await mute(page); await page.goto('/');
  const before = await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/world.ts', draftPath = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(repoPath), { worldState } = await import(fixturePath), { createTurnDraft } = await import(draftPath);
    const repo = await SaveRepository.open();
    try {
      const state = await repo.create(worldState());
      await repo.saveDraft(createTurnDraft(state.saveId,state.revision,'copy-preview','regular',''),null);
      return repo.exportRaw(state.saveId);
    } finally { repo.close(); }
  });
  await page.goto('/#game/save-a'); await expect(page.locator('.game-layout')).toBeVisible();
  await openWorkflow(page);
  await expect(page.locator('.workflow-fee')).toHaveText('生成可能产生费用。');
  await page.locator('.workflow-fee').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('workflow.png'), animations: 'disabled' });
  const after = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open(); try { return await repo.exportRaw('save-a'); } finally { repo.close(); }
  });
  expect(after).toEqual(before);
});
