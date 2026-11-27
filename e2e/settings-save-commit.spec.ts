import { expect, test } from './helpers/test';
import { addChannel, aiPage, confirmAiReload, openAiSettings, openChannel } from './helpers/aiSettings';
import type { Page } from '@playwright/test';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/services/ai/configuration.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(path);
    const config = defaultAiConfig();
    config.channels = ['a', 'b'].map(id => ({ ...newChannel(), id, name: id, defaultModel: 'fixture' }));
    config.routes.story = { channelId: 'a', modelId: 'fixture' };
    saveAiConfig(localStorage, config);
    localStorage.setItem('heijin.credential.v1:a', 'fixture-old');
  });
}

async function editor(page: Page, channel = 'a') {
  const root = await openAiSettings(page);
  await openChannel(root, channel);
  return {
    name: root.getByLabel('渠道名称', { exact: true }),
    key: root.getByLabel('API 密钥', { exact: true }),
    status: root.locator('.ai-save-bar [role=status]'),
    remember: root.getByRole('switch', { name: '记住密钥' }),
    save: root.getByRole('button', { name: '保存 AI 配置', exact: true }),
  };
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/idb.ts';
    const { request } = await import(path);
    const db = await request(indexedDB.open('heijin.ai-settings-lock', 1));
    try {
      const durable = await request(db.transaction('lock').objectStore('lock').get('published'));
      return {
        names: JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels.map((item: {name: string}) => item.name),
        key: localStorage.getItem('heijin.credential.v1:a'), session: sessionStorage.getItem('heijin.credential.v1:a'),
        synchronized: (durable?.id ?? null) === localStorage.getItem('heijin.ai.settings-receipt.v1'),
      };
    } finally { db.close(); }
  });
}

type Fault = 'abort' | 'constraint' | 'receipt-rollback' | 'key-rollback' | 'config-rollback';
async function inject(page: Page, fault: Fault) {
  await page.evaluate(mode => {
    const originalConfig = localStorage.getItem('heijin.ai.v1');
    const put = IDBObjectStore.prototype.put;
    const set = Storage.prototype.setItem;
    if (mode === 'receipt-rollback') Reflect.set(window, 'releaseReceiptFault', () => {
      IDBObjectStore.prototype.put = put;
      Storage.prototype.setItem = set;
    });
    let pending: IDBTransaction | undefined;
    let fired = false;
    IDBObjectStore.prototype.put = function(value, key) {
      const result = put.call(this, value, key);
      if (key === 'published' && this.transaction.db.name === 'heijin.ai-settings-lock' && !fired) {
        pending = this.transaction;
        if (mode === 'constraint') {
          this.add(value, key).onerror = event => {
            fired = true;
            Reflect.set(window, 'fixtureAbort', (event.target as IDBRequest).error?.name);
          };
        }
      }
      return result;
    };
    Storage.prototype.setItem = function(key, value) {
      if (fired && mode === 'receipt-rollback' && key === 'heijin.ai.settings-receipt.v1')
        throw new DOMException('recovery marker denied', 'QuotaExceededError');
      if (fired && mode === 'config-rollback' && key === 'heijin.ai.v1' && value === originalConfig)
        throw new DOMException('configuration rollback denied', 'QuotaExceededError');
      if (fired && mode === 'key-rollback' && key === 'heijin.credential.v1:a' && value === 'fixture-old')
        throw new DOMException('rollback denied', 'QuotaExceededError');
      set.call(this, key, value);
      if (key === 'heijin.ai.settings-receipt.v1' && mode !== 'constraint' && pending && !fired) {
        fired = true;
        pending.abort();
        Reflect.set(window, 'fixtureAbort', 'abort');
      }
    };
  }, fault);
}

for (const fault of ['abort', 'constraint', 'receipt-rollback'] as const) {
  test(`保存最终事务 ${fault}：真实存储、草稿与恢复后的重试`, async ({ page, context }) => {
    await context.route('https://**/*', route => route.fulfill({ json: { data: [] } }));
    await seed(page);
    const ui = await editor(page);
    await ui.name.fill('基准');
    await ui.save.click();
    await expect(ui.status).toContainText('已保存');
    const before = await state(page);
    await inject(page, fault);
    await ui.name.fill('编辑中');
    await ui.key.fill('fixture-edit');
    await ui.save.click();
    await expect(ui.status).toContainText('保存失败');
    expect(await page.evaluate(() => Reflect.get(window, 'fixtureAbort'))).toBe(fault === 'constraint' ? 'ConstraintError' : 'abort');
    expect(await state(page)).toEqual({ ...before, synchronized: fault !== 'receipt-rollback' });
    await expect(ui.name).toHaveValue('编辑中');
    await expect(ui.key).toHaveValue('fixture-edit');
    if (fault === 'receipt-rollback') {
      await expect(ui.status).toContainText('同步标记');
      await expect(ui.save).toBeDisabled();
      await expect(ui.status).not.toContainText('保持原样');
      await page.reload(); // removes the fault, with a real durable/visible mismatch still present
      const fresh = await editor(page, '基准');
      await fresh.name.fill('刷新后重试');
      await fresh.save.click();
      await expect(fresh.status).toContainText('已保存');
      expect(await state(page)).toEqual({ ...before, names: ['刷新后重试', 'b'] });
    } else {
      await expect(ui.save).toBeEnabled();
      await ui.save.click();
      await expect(ui.status).toContainText('已保存');
      expect(await state(page)).toEqual({ ...before, names: ['编辑中', 'b'], key: 'fixture-edit' });
      await expect(ui.save).toBeDisabled();
    }
  });
}

test('失败保存与其他标签并发，保留另一渠道并保护后续密钥轮换', async ({ page, context }) => {
  await context.route('https://**/*', route => route.fulfill({ json: { data: [] } }));
  await seed(page);
  const other = await context.newPage();
  await other.goto('/');
  const [mine, peer] = await Promise.all([editor(page), editor(other, 'b')]);
  await inject(page, 'key-rollback');
  await mine.key.fill('fixture-edit');
  await mine.name.fill('我的渠道');
  await peer.name.fill('其他渠道');
  await Promise.all([mine.save.click(), peer.save.click()]);
  await expect(mine.status).toContainText('没能完全恢复');
  await expect(peer.status).toContainText('已保存');
  expect(await state(page)).toEqual({ names: ['a','其他渠道'], key: 'fixture-edit', session: null, synchronized: true });
  await other.reload();
  const rotated = await editor(other);
  await rotated.key.fill('fixture-peer');
  await rotated.save.click();
  await expect(rotated.status).toContainText('已保存');
  await expect(mine.status).toContainText('重新读取最新配置');
  await expect(mine.name).toHaveValue('我的渠道');
  await expect(mine.key).toHaveValue('fixture-edit');
  await expect(mine.save).toBeDisabled();
  const peerState = { names: ['a','其他渠道'], key: 'fixture-peer', session: null, synchronized: true };
  expect(await state(page)).toEqual(peerState);
  await confirmAiReload(page);
  await expect(mine.status).toContainText('已载入最新配置');
  await expect(mine.name).toHaveValue('a');
  await expect(mine.key).toHaveValue('fixture-peer');
  expect(await state(page)).toEqual(peerState);
  await mine.name.fill('重新编辑'); await mine.save.click();
  await expect(mine.status).toContainText('已保存');
  expect(await state(page)).toEqual({ ...peerState, names: ['重新编辑','其他渠道'] });
});


test('没有 Web Locks 时，首次保存中止恢复密钥位置，重试合并另一标签的提交', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await context.route('https://**/*', route => route.fulfill({ json: { data: [] } }));
  await seed(page);
  const other = await context.newPage();
  await other.goto('/');
  const [mine, peer] = await Promise.all([editor(page), editor(other, 'b')]);
  await inject(page, 'abort');
  await mine.name.fill('本页修改');
  await mine.key.fill('fixture-session');
  await mine.remember.uncheck();
  await mine.save.click();
  await expect(mine.status).toContainText('保存失败');
  expect(await state(page)).toEqual({ names: ['a', 'b'], key: 'fixture-old', session: null, synchronized: true });
  await expect(mine.remember).not.toBeChecked();
  await expect(mine.save).toBeEnabled();
  await peer.name.fill('另一页修改');
  await peer.save.click();
  await expect(peer.status).toContainText('已保存');
  await mine.save.click();
  await expect(mine.status).toContainText('已保存');
  expect(await state(page)).toEqual({ names: ['本页修改','另一页修改'], key: null, session: 'fixture-session', synchronized: true });
  expect((await state(other)).session).toBeNull();
});


test('原配置回滚受阻后确认重读，重新编辑新增渠道并保留另一标签的修改', async ({ page, context }) => {
  await context.route('https://**/*', route => route.fulfill({ json: { data: [] } }));
  await seed(page);
  const other = await context.newPage();
  await other.goto('/');
  const peer = await editor(other, 'b');
  const root = await openAiSettings(page);
  await addChannel(root, { preset: 'Gemini', name: '新增渠道', key: 'fixture-new' });
  await inject(page, 'config-rollback');
  const save = root.getByRole('button', { name: '保存 AI 配置', exact: true });
  const status = root.locator('.ai-save-bar [role=status]');
  await save.click();
  await expect(status).toContainText('无法恢复原配置');
  await expect(save).toBeDisabled();
  expect((await state(page)).names).toEqual(['a', 'b', '新增渠道']);
  const keyOfNewChannel = () => page.evaluate(() => {
    const id = JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels[2].id;
    return localStorage.getItem('heijin.credential.v1:' + id);
  });
  expect(await keyOfNewChannel()).toBeNull();
  await peer.name.fill('其他页');
  await peer.save.click();
  await expect(peer.status).toContainText('已保存');
  await confirmAiReload(root);
  await expect(status).toContainText('已载入最新配置');
  await expect(root.getByLabel('API 密钥', {exact: true})).toHaveValue('');
  expect(await keyOfNewChannel()).toBeNull();
  await root.getByLabel('API 密钥', {exact: true}).fill('fixture-new');
  await save.click();
  await expect(status).toContainText('已保存');
  expect((await state(page)).names).toEqual(['a', '其他页', '新增渠道']);
  expect(await keyOfNewChannel()).toBe('fixture-new');
});

for (const change of ['删除渠道', '恢复原名'] as const) {
  test(`部分回滚后另一标签${change}，确认重读前保持草稿并禁止保存`, async ({ page, context }) => {
    await context.route('https://**/*', route => route.fulfill({ json: { data: [] } }));
    await seed(page);
    const root = await openAiSettings(page);
    if (change === '删除渠道') {
      await addChannel(root, { preset: 'Gemini', name: '暂存渠道', key: 'fixture-new' });
    } else {
      await openChannel(root, 'a');
      await root.getByLabel('渠道名称', { exact: true }).fill('暂存渠道');
    }
    await inject(page, 'config-rollback');
    const save = root.getByRole('button', { name: '保存 AI 配置', exact: true });
    const status = root.locator('.ai-save-bar [role=status]');
    await save.click();
    await expect(status).toContainText('无法恢复原配置');
    await expect(save).toBeDisabled();
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels
      .find((c: {name: string}) => c.name === '暂存渠道').id as string);
    const peer = await context.newPage(); await peer.goto('/');
    const theirs = await editor(peer, '暂存渠道');
    if (change === '删除渠道') {
      await peer.getByRole('button', { name: '删除渠道', exact: true }).click();
      await peer.getByRole('button', { name: '确认删除渠道', exact: true }).click();
    } else {
      await theirs.name.fill('a');
    }
    await theirs.save.click(); await expect(theirs.status).toContainText('已保存');
    const marker = await peer.evaluate(() => localStorage.getItem('heijin.ai.settings-receipt.v1'));
    const actual = await state(peer);
    expect(actual).toEqual({ names: ['a','b'], key: 'fixture-old', session: null, synchronized: true });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('heijin.ai.settings-receipt.v1'))).toBe(marker);

    // Both AI pages share the draft and the recovery requirement.
    await aiPage(root, 'routing'); await expect(save).toBeDisabled();
    await aiPage(root, 'channels');
    await root.getByRole('button', { name: '重新读取最新配置', exact: true }).click();
    await page.getByRole('dialog', { name: '重新读取最新配置？' }).getByRole('button', { name: '取消' }).click();
    await expect(save).toBeDisabled();
    expect(await state(page)).toEqual(actual);
    // Mobile may return to the list when changing pages; the draft is still visible there.
    const retained = root.getByRole('button', { name: '编辑渠道：暂存渠道', exact: true });
    if (await retained.isVisible()) await expect(retained).toBeVisible();
    else await expect(root.getByLabel('渠道名称', {exact: true})).toHaveValue('暂存渠道');
    await confirmAiReload(root);
    await expect(status).toContainText('已载入最新配置');
    await expect(save).toBeDisabled();
    expect(await state(page)).toEqual(actual);
    expect(await page.evaluate(() => localStorage.getItem('heijin.ai.settings-receipt.v1'))).toBe(marker);
    if (change === '删除渠道') {
      expect(await page.evaluate(key => [localStorage.getItem(key), sessionStorage.getItem(key)], 'heijin.credential.v1:' + id)).toEqual([null,null]);
    }
    await openChannel(root, 'a'); await root.getByLabel('渠道名称', {exact: true}).fill('重新编辑');
    await save.click(); await expect(status).toContainText('已保存');
    expect(await state(page)).toEqual({ ...actual, names: ['重新编辑','b'] });
  });
}

test('同步标记回滚失败且首次确认重读失败，解除故障后才能接纳新基准', async ({ page }) => {
  await seed(page);
  const ui = await editor(page);
  await inject(page, 'receipt-rollback');
  await ui.name.fill('本页草稿'); await ui.save.click();
  await expect(ui.status).toContainText('同步标记');
  await expect(ui.save).toBeDisabled();
  await confirmAiReload(page);
  await expect(ui.status).toContainText('读取失败');
  await expect(ui.name).toHaveValue('本页草稿'); await expect(ui.save).toBeDisabled();
  expect((await state(page)).synchronized).toBe(false);
  await page.evaluate(() => Reflect.get(window, 'releaseReceiptFault')());
  await confirmAiReload(page);
  await expect(ui.status).toContainText('已载入最新配置'); await expect(ui.name).toHaveValue('a');
  expect((await state(page)).synchronized).toBe(true);
  await ui.name.fill('重新编辑'); await ui.save.click(); await expect(ui.status).toContainText('已保存');
});

for (const legacyState of ['首次保存', '重复保存']) {
  test(`旧版遗留的同步标记（${legacyState}）仅在明确放弃后对齐，恢复过程不写业务数据`, async ({ page }) => {
    await seed(page);
    await page.evaluate(async previousSave => {
      const path = '/src/services/storage/idb.ts';
      const { request, transaction } = await import(path);
      const open = indexedDB.open('heijin.ai-settings-lock', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('lock');
      const db = await request(open);
      if (previousSave) await transaction(db, ['lock'], 'readwrite', (tx: IDBTransaction) =>
        request(tx.objectStore('lock').put({ id: crypto.randomUUID(), time: Date.now() }, 'published')));
      db.close();
      localStorage.setItem('heijin.ai.settings-receipt.v1', crypto.randomUUID());
    }, legacyState === '重复保存');
    await page.reload();
    const ui = await editor(page);
    await ui.name.fill('未提交的草稿');
    await ui.save.click();
    await expect(ui.status).toContainText('旧版同步标记', { timeout: 12000 });
    await expect(ui.name).toHaveValue('未提交的草稿');
    expect((await state(page)).synchronized).toBe(false);
    await page.evaluate(() => {
      for (const method of ['setItem','removeItem'] as const) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function(key: string, value?: string) {
          if (key === 'heijin.ai.v1' || key.startsWith('heijin.credential.v1:')) throw Error('unexpected business write');
          return original.call(this, key, value!);
        };
      }
    });
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(ui.status).toContainText('已载入最新配置');
    expect(await state(page)).toEqual({ names: ['a','b'], key: 'fixture-old', session: null, synchronized: true });
    await page.reload();
    const reopened = await editor(page);
    await reopened.name.fill('恢复后保存');
    await reopened.save.click();
    await expect(reopened.status).toContainText('已保存');
  });
}
