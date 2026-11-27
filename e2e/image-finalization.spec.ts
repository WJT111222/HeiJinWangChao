import type { Page } from '@playwright/test';
import type { Job } from '../src/services/images/library';
import { expect, test } from './helpers/test';

async function imageSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '文生图', exact: true }).click();
  return page.locator('.image-tools');
}

test('跨标签配置保留独立字段和草稿，同字段冲突须显式选择', async ({ page, context }) => {
  test.setTimeout(60000);
  const a = await imageSettings(page);
  await a.getByLabel('启用文生图').check();
  const other = await context.newPage(),
    b = await imageSettings(other);
  const save = (pane: typeof a) => pane.getByRole('button', { name: '保存文生图设置', exact: true });
  const style = (pane: typeof a) => pane.getByRole('combobox', { name: '画风', exact: true });
  const model = (pane: typeof a) => pane.getByRole('combobox', { name: '图片模型', exact: true });
  await model(a).fill('local-model');
  await style(b).fill('水彩');
  await save(a).click();
  await expect(model(b)).toHaveValue('local-model');
  await expect(style(b)).toHaveValue('水彩');
  await save(b).click();
  await expect(style(a)).toHaveValue('水彩');

  await style(a).fill('本页画风');
  await model(a).fill('keep-local');
  await model(b).fill('remote-model');
  await a.getByLabel('附加正向提示词').fill('本地草稿');
  await style(b).fill('远端画风');
  await save(b).click();
  await expect(save(a)).toBeDisabled();
  await expect(style(a)).toHaveValue('本页画风');
  const conflict = a.getByRole('group', { name: 'style', exact: true });
  await expect(conflict.getByText('远端画风', { exact: true })).toBeVisible();
  await conflict.getByRole('button', { name: '采用其他页面的冲突值' }).click();
  await expect(save(a)).toBeDisabled();
  await expect(style(a)).toHaveValue('远端画风');
  await expect(a.getByLabel('附加正向提示词')).toHaveValue('本地草稿');

  await a.getByRole('button', { name: '保留本页的冲突值' }).click();
  await b.getByLabel('启用文生图').uncheck();
  await expect(model(a)).toHaveCount(0);
  await b.getByLabel('启用文生图').check();
  await expect(model(a)).toHaveValue('keep-local');
  await save(a).click();
  await expect(model(b)).toHaveValue('keep-local');
  await expect(b.getByLabel('附加正向提示词')).toHaveValue('本地草稿');

  // Exercise concurrent writes based on the same snapshot before either storage event is processed.
  const writeFrom = (tab: Page, field: 'positive' | 'negative') =>
    tab.evaluateHandle(async (field) => {
      const path = '/src/services/images/config.ts',
        { config, saveConfig } = await import(path);
      const base = config();
      return () => saveConfig(base, { ...base, [field]: field });
    }, field);
  const left = await writeFrom(page, 'positive'),
    right = await writeFrom(other, 'negative');
  await Promise.all([left.evaluate((save) => save()), right.evaluate((save) => save())]);
  const stored = await page.evaluate(async () => {
    const path = '/src/services/images/config.ts';
    return (await (await import(path)).savedConfig()).value;
  });
  expect(stored).toMatchObject({
    enabled: true,
    connections: { openai: { model: 'keep-local' } },
    style: '远端画风',
    positive: 'positive',
    negative: 'negative',
  });
  for (const pane of [a, b]) {
    await expect(pane.getByLabel('附加正向提示词')).toHaveValue('positive');
    await expect(pane.getByLabel('负向提示词')).toHaveValue('negative');
  }
});

test('跨标签关闭自动子开关只取消该规则的等待任务，运行中和手动任务继续', async ({ page, context }) => {
  test.setTimeout(65000);
  await page.goto('/');
  const settings = await imageSettings(await context.newPage());
  await settings.getByLabel('启用文生图').check();
  await settings.getByLabel('新普通 NPC 头像').check();
  await settings.getByLabel('API 基础地址', { exact: true }).fill('http://127.0.0.1:5174');
  await settings.getByLabel('生成路径').fill('image-rule-mock');
  const save = settings.getByRole('button', { name: '保存文生图设置' });
  await save.click();
  await expect(settings.getByText('设置已保存', { exact: true })).toBeVisible();
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/image-rule-mock', async (route) => {
    posts++;
    if (posts === 1) await gate;
    await route.fulfill({
      json: {
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==',
          },
        ],
      },
    });
  });

  const queue = await page.evaluateHandle(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts',
      fixturePath = '/src/tests/fixtures/game.ts',
      queuePath = '/src/services/images/queue.ts',
      modelPath = '/src/services/images/model.ts';
    const { SaveRepository } = await import(repoPath),
      { game, npc, story } = await import(fixturePath),
      { enqueue, afterSettlement } = await import(queuePath),
      { targetFor } = await import(modelPath);
    const repo = await SaveRepository.open(),
      state = game('rule-save');
    state.npc = Object.fromEntries(['first', 'second', 'manual', 'later'].map((id) => [id, npc(id)]));
    state.turnNumber = state.revision = 1;
    state.journal = [{ turnId: 'rule-turn', revision: 1, story, relatedActorRefs: [] }];
    const backup = { state };
    await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
    const { instance } = await repo.loadGame(state.saveId);
    const scope = { saveId: state.saveId, createdAt: state.createdAt, instance };
    return {
      dispatch(ids: string[]) {
        const before = structuredClone(state);
        before.journal = [];
        for (const id of ids) delete before.npc[id];
        afterSettlement(repo.images, before, state, instance);
      },
      manual() {
        return enqueue(repo.images, scope, targetFor(state, 'npc', 'manual'), 'avatar');
      },
      async phases() {
        const { jobs } = await repo.images.read(state.saveId);
        return jobs.map((j: Job) => [j.automatic ? 'auto' : 'manual', j.phase].join('/')).sort();
      },
      close() {
        repo.close();
      },
    };
  });
  try {
    await queue.evaluate((q) => q.dispatch(['first', 'second']));
    await expect.poll(() => posts).toBe(1);
    const manual = queue.evaluate((q) => q.manual());
    const phases = () => queue.evaluate((q) => q.phases());
    const waiting = ['auto/图片生成', 'auto/等待', 'manual/等待'].sort();
    await expect.poll(phases).toEqual(waiting);
    await settings.getByRole('combobox', { name: '画风', exact: true }).fill('更新画风');
    await save.click();
    await expect(settings.getByText('设置已保存', { exact: true })).toBeVisible();
    expect(await phases()).toEqual(waiting);
    await settings.getByLabel('新普通 NPC 头像').uncheck();
    await save.click();
    await expect.poll(phases).toEqual(['auto/图片生成', 'auto/取消', 'manual/等待'].sort());
    await queue.evaluate((q) => q.dispatch(['later']));
    release();
    await manual;
    expect(await phases()).toEqual(['auto/完成', 'auto/取消', 'manual/完成'].sort());
    expect(posts).toBe(2);
  } finally {
    release();
    await queue.evaluate((q) => q.close());
  }
});

test('升级前的 V8 结构异常在首页显示可操作提示，并可重新读取原记录', async ({ page }) => {
  await page.route('**/schema-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
  );
  await page.goto('/schema-fixture');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('heijinwangchao', 8);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('saves').add('已有存档', 'save-a');
          open.result.createObjectStore('imageCollections').add('已有图片元数据', 'save-a');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          open.result.close();
          resolve();
        };
      }),
  );
  await page.goto('/');
  await expect(page.getByText(/本地图片数据库结构异常（imageFiles）/).first()).toBeVisible();
  const records = await page.evaluate(async () => {
    const path = '/src/services/storage/idb.ts',
      { request } = await import(path);
    const db: IDBDatabase = await request(indexedDB.open('heijinwangchao'));
    try {
      const tx = db.transaction(['saves', 'imageCollections']);
      return [
        db.version,
        ...(await Promise.all(
          ['saves', 'imageCollections'].map((store) => request(tx.objectStore(store).get('save-a'))),
        )),
      ];
    } finally {
      db.close();
    }
  });
  expect(records).toEqual([8, '已有存档', '已有图片元数据']);
});

test('旧转化器提示只确认一次，地址、模型和独立密钥原样保留', async ({page}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/services/images/config.ts';
    const {defaults,configKey,imageVault,credentialId} = await import(path);
    const old = {...defaults,enabled:false,textModel:'legacy-converter',textBase:'https://legacy.mock.invalid'};
    localStorage.setItem(configKey,JSON.stringify(old));
    imageVault().set(credentialId('text',old.textBase),'migration-test-value',true);
  });
  const posts: string[] = [];
  await page.route('https://**/*', route => { if (route.request().method() === 'POST') posts.push(route.request().url()); return route.abort(); });
  const panel = await imageSettings(page);
  await expect(panel.getByText(/之前单独填写的文本模型（legacy-converter）/)).toBeVisible();
  await expect(panel.getByLabel('文本密钥')).toHaveCount(0);
  await panel.getByRole('button',{name:'知道了'}).click();
  const next = await imageSettings(page);
  await next.getByLabel('启用文生图').check();
  await expect(next.getByRole('button',{name:'在模型分配里改'})).toBeVisible();
  await expect(next.getByRole('button',{name:'知道了'})).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const path = '/src/services/images/config.ts';
    const {config,imageVault,credentialId} = await import(path);
    const old = config();
    return [old.textModel,old.textBase,imageVault().get(credentialId('text',old.textBase))];
  })).toEqual(['legacy-converter','https://legacy.mock.invalid','migration-test-value']);
  expect(posts).toEqual([]);
});
