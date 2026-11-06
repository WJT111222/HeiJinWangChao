import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openGameTools } from './helpers/gameLayout';

const broken = { saveId: 'broken', title: '无法解析的旧人生', schemaVersion: 99, original: { text: '【旁白】原始记录\n第二行', unknown: [null, 7] } };
const draft = { saveId: 'broken', oldFormat: '不作迁移', story: { narrative: '未提交正文' } };
const receipts = [{ saveId: 'broken', turnId: 'turn-a', legacyHash: 'abc' }, { saveId: 'broken', turnId: 'turn-b', extra: 42 }];
let modelCalls: number;
test.beforeEach(async ({ page }) => {
  modelCalls = 0;
  await page.route('**/*', async route => {
    if (route.request().method() === 'POST') { modelCalls++; await route.abort(); }
    else await route.continue();
  });
});
test.afterEach(() => expect(modelCalls).toBe(0));

async function seed(page: Page, onlyBroken = false) {
  await page.goto('/');
  await page.evaluate(async ({ broken, draft, receipts, onlyBroken }) => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/game.ts';
    const { SaveRepository } = await import(repoPath), { game } = await import(fixturePath);
    const repo = await SaveRepository.open();
    if (!onlyBroken) for (const id of ['save-a', 'save-b']) await repo.create({ ...game(id), title: `正常存档 ${id}` });
    repo.close();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('heijinwangchao'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['saves', 'drafts', 'turnReceipts'], 'readwrite');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
        tx.objectStore('saves').put(broken); tx.objectStore('drafts').put(draft);
        for (const receipt of receipts) tx.objectStore('turnReceipts').put(receipt);
        if (!onlyBroken) {
          tx.objectStore('turnReceipts').put({ saveId: 'save-b', turnId: 'turn-a', protected: true });
        }
      };
    });
    localStorage.setItem('heijin.selected.v1', JSON.stringify('broken'));
  }, { broken, draft, receipts, onlyBroken });
  await page.reload(); await expect(page.locator('.save-card')).toHaveCount(onlyBroken ? 1 : 3);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    return new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const open = indexedDB.open('heijinwangchao'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['saves', 'drafts', 'turnReceipts'], 'readonly'), result: Record<string, unknown[]> = {};
        tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); };
        for (const name of ['saves', 'drafts', 'turnReceipts']) {
          const get = tx.objectStore(name).getAll(); get.onsuccess = () => { result[name] = get.result; };
        }
      };
    });
  });
}
const badCard = (page: Page) => page.locator('.save-card').filter({ hasText: broken.title });

test('混合存档列表独立展示，坏记录不触发全局错误，正常存档都能进入且刷新保持', async ({ page }) => {
  await seed(page); const before = await snapshot(page);
  await expect(badCard(page)).toContainText('无法读取'); await expect(badCard(page)).toContainText('存档记录 ID：broken');
  await expect(badCard(page).getByRole('button', { name: /读取存档|选择/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('还没有开始的人生。')).toHaveCount(0);
  for (const id of ['save-a', 'save-b']) {
    await page.locator('.save-card').filter({ hasText: `正常存档 ${id}` }).getByRole('button', { name: /读取存档/ }).click();
    await openGameTools(page, true);
    await expect(page.getByRole('heading', { name: '林舟', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '游戏首页', exact: true }).click();
    await expect(page.locator('.save-card')).toHaveCount(3);
  }
  await page.reload(); await expect(page.locator('.save-card')).toHaveCount(3); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: /开始新游戏/ }).click(); await expect(page.getByLabel('姓名', { exact: true })).toBeVisible();
});

test('下载 JSON 完整保留坏记录、草稿和回执，读取下载不改库', async ({ page }) => {
  await seed(page); const before = await snapshot(page);
  const pending = page.waitForEvent('download'); await badCard(page).getByRole('button', { name: '导出原始数据' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('heijin-raw-save.json');
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(data).toEqual({ format: 'heijin-raw-save', version: 1, records: {
    saves: [{ key: 'broken', value: broken }], drafts: [{ key: 'broken', value: draft }],
    turnReceipts: receipts.map(value => ({ key: ['broken', value.turnId], value })),
  } });
  expect(await snapshot(page)).toEqual(before); await expect(badCard(page).getByRole('status')).toContainText('数据库未修改');
});

test('二次确认取消不删数据，确认后只删选中的三类记录，刷新不再出现', async ({ page }) => {
  await seed(page); const before = await snapshot(page);
  await badCard(page).getByRole('button', { name: '删除存档' }).click();
  const dialog = page.getByRole('dialog', { name: '删除这份存档？' });
  await expect(dialog).toContainText('永久删除'); await expect(dialog).toContainText('无法撤销'); await expect(dialog).toContainText('broken');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(await snapshot(page)).toEqual(before);
  await badCard(page).getByRole('button', { name: '删除存档' }).click(); await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.save-card')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('提交回执已删除'); await expect(page.getByRole('alert')).toHaveCount(0);
  const after = await snapshot(page);
  for (const store of Object.keys(before)) expect(after[store]).toEqual(before[store].filter(value => (value as { saveId: string }).saveId !== 'broken'));
  await page.reload(); await expect(page.locator('.save-card')).toHaveCount(2); await expect(page.getByText('无法读取', { exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(after);
});

test('只有坏记录时不显示空档状态、不能继续游戏，正常删除流程仍可用', async ({ page }) => {
  await seed(page, true); await expect(page.getByRole('button', { name: '继续游戏 →' })).toBeDisabled();
  await expect(page.getByText('还没有开始的人生。')).toHaveCount(0);
  await badCard(page).getByRole('button', { name: '删除存档' }).click(); await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('还没有开始的人生。')).toBeVisible();
  await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', fp = '/src/tests/fixtures/game.ts';
    const { SaveRepository } = await import(rp), { game } = await import(fp);
    const repo = await SaveRepository.open(); await repo.create(game()); repo.close();
  });
  await page.getByRole('button', { name: '刷新列表' }).click(); await expect(page.locator('.save-card')).toHaveCount(1);
  await page.locator('.save-card').getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('还没有开始的人生。')).toBeVisible(); expect((await snapshot(page)).saves).toEqual([]);
});

test('存储整体不可用明确报错，关闭提示不会重复弹回或伪装成没有存档', async ({ page }) => {
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('denied', 'SecurityError'); }; });
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('本地存档无法打开');
  await page.getByRole('button', { name: '关闭提示' }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '已有存档' })).toContainText('本地存档无法打开');
  await expect(page.getByText('还没有开始的人生。')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '关闭资料界面' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeDisabled();
});

test('列表请求失败明确提示，手动刷新恢复而不是把数据库错误当作坏记录', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) { if (this.name === 'saves') throw new DOMException('denied', 'SecurityError'); return getAll.apply(this, args); };
    Reflect.set(window, 'restoreRead', () => { IDBObjectStore.prototype.getAll = getAll; });
  });
  await page.getByRole('button', { name: '刷新列表' }).click(); await expect(page.getByRole('alert')).toContainText('列表暂时无法访问');
  await page.getByRole('button', { name: '关闭提示' }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('还没有开始的人生。')).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, 'restoreRead')()); await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.locator('.save-card')).toHaveCount(3); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('导出和删除失败分别可定位且保留全部记录；重试删除成功后清除错误', async ({ page }) => {
  await seed(page); const before = await snapshot(page);
  await page.evaluate(() => {
    const getAll = IDBObjectStore.prototype.getAll, remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.getAll = function (...args) { if (this.name === 'drafts') throw new DOMException('denied', 'SecurityError'); return getAll.apply(this, args); };
    IDBObjectStore.prototype.delete = function (key) { if (this.name === 'saves') throw new DOMException('denied', 'SecurityError'); return remove.call(this, key); };
    Reflect.set(window, 'restoreRaw', () => { IDBObjectStore.prototype.getAll = getAll; IDBObjectStore.prototype.delete = remove; });
  });
  await badCard(page).getByRole('button', { name: '导出原始数据' }).click(); await expect(badCard(page).getByRole('status')).toContainText('导出失败');
  await badCard(page).getByRole('button', { name: '删除存档' }).click(); await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('删除失败');
  await page.evaluate(() => Reflect.get(window, 'restoreRaw')()); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '确认删除' }).click(); await expect(page.locator('.save-card')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText(/导出失败/)).toHaveCount(0);
});
