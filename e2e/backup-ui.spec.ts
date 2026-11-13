import fs from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { openLibrary } from './helpers/home';
import { rawSnapshot } from './helpers/mobileHome';

// 存档备份界面：导出、导入、覆盖、多份与出错。全部只在本机进行，过程中不允许任何 POST。
let posts = 0;
test.beforeEach(async ({ context }) => {
  test.setTimeout(90_000);
  posts = 0;
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') { posts++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
});
test.afterEach(() => expect(posts).toBe(0));

type Seed = { id: string; title: string; turns: number };
/** 已玩过若干回合的存档只能经由正式导入路径写入；这里不绕过仓库直接改库。 */
async function seed(page: Page, saves: Seed[]) {
  await page.goto('/');
  await page.evaluate(async saves => {
    const rp = '/src/services/storage/saveRepository.ts', fp = '/src/tests/fixtures/game.ts';
    const { SaveRepository } = await import(rp), { game } = await import(fp), repo = await SaveRepository.open();
    try {
      for (const save of saves) {
        const base = game(save.id), journal = Array.from({ length: save.turns }, (_, i) => ({ turnId: `${save.id}-t${i}`, revision: i + 1,
          relatedActorRefs: [], story: { turnKind: i ? 'regular' : 'opening', narrative: `【旁白】第 ${i + 1} 回合。`, summary: `第 ${i + 1} 回合`, variableGuide: [] } }));
        const entry = { state: { ...base, openingTimePending: undefined, openingInitializationPending: undefined, title: save.title,
          revision: save.turns, turnNumber: save.turns, journal, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-10T15:41:00Z' } };
        await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
      }
    } finally { repo.close(); }
    localStorage.removeItem('heijin.backup.status.v1');
  }, saves);
  await page.reload();
}
/** 模拟本机继续游玩/撤回：用正式覆盖路径改动回合数与版本号。 */
async function setProgress(page: Page, id: string, revision: number, turns: number) {
  await page.evaluate(async ({ id, revision, turns }) => {
    const rp = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(rp), repo = await SaveRepository.open();
    try {
      const { state } = await repo.loadGame(id);
      const journal = Array.from({ length: turns }, (_, i) => state.journal[i] ?? { turnId: `${id}-n${i}`, revision: Math.min(revision, i + 1),
        relatedActorRefs: [], story: { turnKind: i ? 'regular' : 'opening', narrative: `【旁白】第 ${i + 1} 回合。`, summary: `第 ${i + 1} 回合`, variableGuide: [] } });
      const entry = { state: { ...state, revision, turnNumber: turns, journal } };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation, { overwrite: true });
    } finally { repo.close(); }
  }, { id, revision, turns });
}
async function removeSave(page: Page, id: string) {
  await page.evaluate(async id => {
    const rp = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(rp), repo = await SaveRepository.open();
    try {
      const summary = (await repo.list()).find((s: { saveId?: string }) => s.saveId === id);
      await repo.delete(id, summary.revision, summary.instance ?? null);
    } finally { repo.close(); }
  }, id);
}
async function backupFile(download: Download) {
  const file = await download.path();
  return { name: download.suggestedFilename(), file, json: JSON.parse(fs.readFileSync(file!, 'utf8')) };
}
const desktopOnly = () => test.skip(test.info().project.name !== 'desktop', '电脑端存档馆');
const mobileOnly = () => test.skip(test.info().project.name !== 'mobile', '手机端车票');
const card = (page: Page, title: string) => page.locator('.save-card').filter({ hasText: title });
const dialog = (page: Page) => page.locator('.backup-import-dialog');

test('电脑端：单份导出生成文件、标记已备份、提醒消失，存档库原样不动', async ({ page }) => {
  desktopOnly();
  await seed(page, [{ id: 'save-a', title: '沈砚 · 重庆', turns: 6 }, { id: 'save-b', title: '周远 · 上海', turns: 2 }]);
  await openLibrary(page);
  await expect(page.locator('.backup-banner')).toHaveText('有 1 份存档从未备份。清除浏览器数据会丢失进度。');
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('从未备份');
  await expect(page.locator('.lib-foot')).toContainText('备份文件不含 AI 密钥与设置');
  const before = await rawSnapshot(page);

  const downloading = page.waitForEvent('download');
  await card(page, '沈砚').getByRole('button', { name: '导出备份' }).click();
  const { name, json } = await backupFile(await downloading);
  expect(name).toMatch(/\.heijin\.json$/);
  expect(json.saves).toHaveLength(1);
  expect(JSON.stringify(json)).not.toMatch(/apiKey|sk-/);
  await expect(page.locator('.status-msg')).toContainText(`已导出「沈砚 · 重庆」第 6 回合的备份：${name}`);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('已备份 · 今天');
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveClass(/ok/);
  await expect(page.locator('.backup-banner')).toHaveCount(0);
  expect(await rawSnapshot(page)).toEqual(before);

  await page.reload(); await openLibrary(page);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('已备份 · 今天');
  // 继续游玩两回合后提示差值；撤回到备份之前（回合回退、版本号仍增加）只说有变动。
  await setProgress(page, 'save-a', 8, 8); await page.reload(); await openLibrary(page);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('备份后又玩了 2 回合');
  await setProgress(page, 'save-a', 9, 5); await page.reload(); await openLibrary(page);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('备份后存档有变动');
});

test('电脑端：导入新存档、同一文件再导入显示已是最新、本机更新时覆盖需要明确确认', async ({ page }) => {
  desktopOnly();
  await seed(page, [{ id: 'save-a', title: '沈砚 · 重庆', turns: 6 }]);
  await openLibrary(page);
  const downloading = page.waitForEvent('download');
  await card(page, '沈砚').getByRole('button', { name: '导出备份' }).click();
  const { file } = await backupFile(await downloading);

  await removeSave(page, 'save-a'); await page.reload(); await openLibrary(page);
  await expect(page.locator('.save-card')).toHaveCount(0);
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await expect(dialog(page)).toContainText('只读取文件，不会联网');
  await dialog(page).locator('input[type=file]').setInputFiles(file!);
  await expect(dialog(page)).toContainText('第 6 回合');
  await expect(dialog(page).locator('.bk-tag')).toHaveText('新存档');
  await dialog(page).getByRole('button', { name: '导入存档' }).click();
  await expect(page.locator('.status-msg')).toContainText('已导入「沈砚 · 重庆」，它已出现在存档馆里。');
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('已备份 · 今天');

  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(file!);
  await expect(dialog(page).getByRole('button', { name: '已是最新' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();

  await setProgress(page, 'save-a', 9, 9); await page.reload(); await openLibrary(page);
  const before = await rawSnapshot(page);
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(file!);
  await expect(page.getByRole('heading', { name: '覆盖本机存档？' })).toBeVisible();
  await expect(dialog(page).locator('.bk-compare')).toContainText('第 9 回合');
  await expect(dialog(page)).toContainText('本机进度比备份更新');
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  expect(await rawSnapshot(page)).toEqual(before);

  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(file!);
  await dialog(page).getByRole('button', { name: '覆盖并导入' }).click();
  await expect(page.locator('.status-msg')).toContainText('已导入「沈砚 · 重庆」');
  const turns = await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(rp), repo = await SaveRepository.open();
    try { return (await repo.loadGame('save-a')).state.turnNumber; } finally { repo.close(); }
  });
  expect(turns).toBe(6);
  await expect(card(page, '沈砚').locator('.backup-line')).toHaveText('已备份 · 今天');
});

test('电脑端：导出全部、多份导入只默认勾选新存档、坏文件明确报错且不改库', async ({ page }) => {
  desktopOnly();
  await seed(page, [{ id: 'save-a', title: '沈砚 · 重庆', turns: 6 }, { id: 'save-b', title: '周远 · 上海', turns: 3 }]);
  await openLibrary(page);
  await page.getByRole('button', { name: '导出全部' }).click();
  await expect(page.getByRole('heading', { name: '导出全部存档' })).toBeVisible();
  await expect(page.locator('.dialog-consequences')).toContainText('不包含：AI 密钥、渠道与设置、撤回记录');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 2 份存档' }).click();
  const { file, json } = await backupFile(await downloading);
  expect(json.saves).toHaveLength(2);
  await expect(page.locator('.status-msg')).toContainText('已导出 2 份存档的备份');
  await expect(page.locator('.backup-line.ok')).toHaveCount(2);

  const bad = test.info().outputPath('broken.heijin.json');
  fs.writeFileSync(bad, 'not a backup');
  const before = await rawSnapshot(page);
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(bad);
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: '选择备份文件' })).toBeEnabled();
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  expect(await rawSnapshot(page)).toEqual(before);

  await removeSave(page, 'save-b'); await page.reload(); await openLibrary(page);
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(file!);
  await expect(page.getByRole('heading', { name: '导入备份 · 2 份存档' })).toBeVisible();
  const rows = dialog(page).locator('.bk-row');
  await expect(rows.filter({ hasText: '周远' }).locator('.bk-tag')).toHaveText('新存档');
  await expect(rows.filter({ hasText: '周远' }).getByRole('checkbox')).toBeChecked();
  await expect(rows.filter({ hasText: '沈砚' }).locator('.bk-tag')).toHaveText('已是最新');
  await expect(rows.filter({ hasText: '沈砚' }).getByRole('checkbox')).toBeDisabled();
  await dialog(page).getByRole('button', { name: '导入 1 份存档' }).click();
  await expect(page.locator('.status-msg')).toContainText('已导入「周远 · 上海」');
  await expect(page.locator('.save-card')).toHaveCount(2);
});

test('手机端：车票上导出备份并显示状态，导入直接调起系统文件选择', async ({ page }) => {
  mobileOnly();
  await seed(page, [{ id: 'save-a', title: '沈砚 · 重庆', turns: 6 }]);
  await expect(page.locator('.mobile-home')).toBeVisible();
  await expect(page.locator('.mh-reminder')).toHaveText('有 1 份存档从未备份。清除浏览器数据会丢失进度。');
  await expect(page.locator('.mh-backup').first()).toHaveText('从未备份');
  const downloading = page.waitForEvent('download');
  await page.locator('.mh-export').first().click();
  const { file } = await backupFile(await downloading);
  await expect(page.locator('.mh-backup').first()).toHaveText('已备份 · 今天');
  await expect(page.locator('.mh-reminder')).toHaveCount(0);
  await expect(page.locator('.mh-status')).toContainText('已导出「沈砚 · 重庆」第 6 回合的备份');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await (await chooser).setFiles(file!);
  await expect(dialog(page)).toHaveClass(/mobile-sheet/);
  await expect(dialog(page).getByRole('button', { name: '已是最新' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
});
