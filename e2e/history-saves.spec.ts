import { readFile, writeFile } from 'node:fs/promises';
import { settingsTextContrast } from './helpers/settingsContrast';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// Keep the same end-to-end budget when discovered by the normal project config.
test.describe.configure({ timeout: 60000 });

async function seed(page: Page, turns = 7) {
  await page.goto('/');
  await page.evaluate(async turns => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft, elapsedVariables, submission }, { defaultSettings, settingsKey },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      for (let i = 1; i <= turns; i++) {
        const game = await repo.loadGame('save-a'); if (game.draft) await repo.bindTurnAction(game.draft, `合成行动${i}`, true, true);
        await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '正常经过时间', 60) }), ''));
      }
    } finally { repo.close(); }
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const setting of Object.values(settings.memory.summaries) as { automatic: boolean }[]) setting.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://history.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world', 'memory']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-history-key');
  }, turns);
  await page.reload();
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return { ...await repo.loadGame('save-a'), raw: await repo.exportRaw('save-a'), history: await repo.history.list('save-a'), undo: await repo.undoStatus('save-a') }; }
    finally { repo.close(); }
  });
}
async function open(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) > 900) {
    await expect(page.locator('.home-experience')).toBeVisible();
    const button = page.getByRole('button', { name: '存档馆', exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: '历史存档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '历史存档', exact: true })).toBeVisible();
  await expect(page.getByText('正在读取历史存档…')).toHaveCount(0);
}
async function mock(page: Page) {
  const calls: string[] = [], control = { failStory: false };
  await page.route('https://history.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    const state = (await read(page)).state;
    const text = stage === 'story' ? control.failStory ? '<正文>不完整' : '<thinking>继续当前选择。</thinking><正文>【旁白】主角来到公园，沿着小路慢慢散步。</正文><短期记忆>在公园散步。</短期记忆><变量规划>[]</变量规划>'
      : stage === 'variables' ? `<thinking>记录时间。</thinking><说明>时间经过。</说明><命令>\nset worldClock = "${new Date(Date.parse(state.worldClock) + 60000).toISOString()}"\n</命令>`
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
  });
  return { calls, control };
}
async function choose(page: Page, turn: number) {
  await page.getByRole('button', { name: `预览第 ${turn} 回合`, exact: true }).click();
  await expect(page.getByText(`只读历史 · 第 ${turn} 回合结束。`, { exact: false })).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByLabel('从此历史节点开始的行动').fill('改去公园走走');
  await page.getByRole('button', { name: '发送新行动（先确认覆盖）', exact: true }).click();
  await page.getByRole('button', { name: '确认覆盖并继续', exact: true }).click();
}

// Include every store and binary byte: JSON.stringify(ArrayBuffer) alone would hide data loss.
async function recoverySnapshot(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/idb.ts', { request, transaction } = await import(p);
    const db: IDBDatabase = await request(indexedDB.open('heijinwangchao'));
    function binary(value: unknown): unknown {
      if (value instanceof ArrayBuffer) return { arrayBuffer: Array.from(new Uint8Array(value)) };
      if (Array.isArray(value)) return value.map(binary);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, binary(part)]));
      return value;
    }
    try {
      return await transaction(db, Array.from(db.objectStoreNames), 'readonly', async (tx: IDBTransaction) => {
        const result: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
        for (const name of Array.from(db.objectStoreNames)) result[name] = {
          keys: await request(tx.objectStore(name).getAllKeys()), values: binary(await request(tx.objectStore(name).getAll())) as unknown[],
        };
        return result;
      });
    } finally { db.close(); }
  });
}

test('损坏主档的原始导出不解锁收藏删除；二进制保留并可用已有标准备份恢复', async ({ page }, info) => {
  await seed(page, 2); const server = await mock(page), posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await open(page);
  await page.getByRole('button', { name: '保存当前正式节点' }).click();
  await page.getByLabel('历史收藏名称').fill('不可丢失的收藏');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(page.locator('.history-node-list')).toContainText('不可丢失的收藏');
  const original = await read(page);
  expect(original.history.nodes.find((n: { kind: string }) => n.kind === 'manual')).toBeTruthy();
  const savedDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出节点备份' }).click();
  const backupPath = (await (await savedDownload).path())!;
  await page.getByRole('button', { name: '关闭资料界面' }).click();
  const savedId = await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', ip = '/src/services/storage/idb.ts';
    const { SaveRepository } = await import(rp), { request, transaction } = await import(ip), repo = await SaveRepository.open();
    try {
      const state = await repo.load('save-a'), other = { ...state, saveId: 'save-b', title: '其他人生' };
      await repo.importBackup({ state: other }, (await repo.compareBackup({ state: other })).confirmation);
      await repo.history.create('save-b', '另一份收藏');
      const node = (await repo.history.list('save-a')).nodes.find((n: { kind: string }) => n.kind === 'manual');
      const db: IDBDatabase = await request(indexedDB.open('heijinwangchao'));
      try { await transaction(db, ['saves'], 'readwrite', async (tx: IDBTransaction) => {
        await request(tx.objectStore('saves').put({ ...state, schemaVersion: 999 }));
      }); } finally { db.close(); }
      return node.id;
    } finally { repo.close(); }
  });
  await page.reload();
  if (info.project.name === 'desktop') await page.getByRole('button', { name: '存档馆', exact: true }).click();
  else {
    await expect(page.locator('.mh-ticket.bad')).toContainText('存档记录 ID：save-a');
    const index = await page.locator('.mh-ticket-wrap').evaluateAll(items => items.findIndex(item => item.textContent?.includes('存档记录 ID：save-a')));
    expect(index).toBeGreaterThanOrEqual(0);
    await page.getByRole('navigation', { name: '车票页码' }).getByRole('button').nth(index).click();
  }
  const card = info.project.name === 'desktop' ? page.locator('.save-card.bad') : page.locator('.mh-ticket-wrap[aria-current=true]');
  await expect(card).toContainText('原始数据导出不包含手动历史收藏');
  const before = await recoverySnapshot(page);
  const payload = before.historyPayloads.values.find((row: { saveId?: string }) => row.saveId === 'save-a');
  expect(payload.payload.encoding).toBe('gzip'); expect(payload.payload.data.arrayBuffer.length).toBeGreaterThan(0);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出原始数据', exact: true }).click();
  const raw = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(raw.version).toBe(1); expect(raw.records.saves[0].value.schemaVersion).toBe(999);
  expect(raw.records).not.toHaveProperty('historyPayloads');
  await expect(page.getByRole('status').filter({ hasText: '已发起主存档原始数据下载' })).toContainText('不含手动历史收藏');
  await page.screenshot({ path: info.outputPath('unreadable-export-warning.png') });
  expect(await recoverySnapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '删除存档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这份存档？', exact: true });
  await expect(dialog).toContainText('有关联收藏时禁止删除');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已阻止删除');
  await expect(dialog.getByRole('alert')).toContainText('本次未删除任何数据');
  expect(await recoverySnapshot(page)).toEqual(before); expect(server.calls).toEqual([]);
  await page.screenshot({ path: info.outputPath('unreadable-delete-protected.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); expect(await recoverySnapshot(page)).toEqual(before);
  // A verified backup saved BEFORE damage can repair the main record using the existing import flow.
  // The raw rescue JSON above is deliberately NOT represented as an importable collection backup.
  const importer = page.locator('dialog.backup-import-dialog');
  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: '存档馆', exact: true }).click();
    await page.getByRole('button', { name: '导入备份', exact: true }).click();
    await importer.locator('input[type=file]').setInputFiles(backupPath);
  } else {
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入备份', exact: true }).click();
    await (await picker).setFiles(backupPath);
  }
  await expect(importer.getByRole('heading', { name: '覆盖本机存档？', exact: true })).toBeVisible();
  await expect(importer).toContainText('无法读取');
  await importer.getByRole('button', { name: '覆盖并导入', exact: true }).click();
  await expect(importer).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '已导入「测试存档」' })).toBeVisible();
  const after = await recoverySnapshot(page);
  expect(after.historyMetadata).toEqual(before.historyMetadata); expect(after.historyPayloads).toEqual(before.historyPayloads);
  for (const store of ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls']) {
    const rows = (data: typeof before) => data[store].values.filter((row: { saveId?: string }) => row.saveId === 'save-b');
    expect(rows(after)).toEqual(rows(before));
  }
  const restored = await page.evaluate(async id => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { const preview = await repo.history.preview('save-a', { kind: 'manual', id }); repo.history.release(preview.confirmation); return preview.state; }
    finally { repo.close(); }
  }, savedId);
  expect(restored).toEqual(original.state); expect(server.calls).toEqual([]); expect(posts).toEqual([]);
  await page.screenshot({ path: info.outputPath('unreadable-recovered.png') });
});

test('自动五节点只读预览、取消覆盖、旧链不变、日夜与窄屏截图', async ({ page }, info) => {
  await seed(page); const server = await mock(page), before = await read(page); await open(page);
  await expect(page.locator('.history-node-list > li')).toHaveCount(5);
  await page.screenshot({ path: info.outputPath('automatic-night.png') });
  await choose(page, 2); await page.getByRole('navigation', { name: '历史阅读内容' }).getByRole('button', { name: '人物档案', exact: true }).click();
  await expect(page.locator('.history-world')).toContainText(before.state.protagonist.name);
  await page.getByRole('navigation', { name: '历史阅读内容' }).getByRole('button', { name: '正文', exact: true }).click();
  await page.getByLabel('从此历史节点开始的行动').fill('取消的选择');
  await page.getByRole('button', { name: '发送新行动（先确认覆盖）' }).click();
  await expect(page.getByLabel('覆盖时间线确认')).toContainText('第 3～7 回合');
  await page.screenshot({ path: info.outputPath('overwrite-warning.png') });
  await page.getByRole('button', { name: '取消，保留原进度' }).click();
  expect(await read(page)).toEqual(before); expect(server.calls).toEqual([]);
  await page.evaluate(() => { document.documentElement.dataset.appearance = 'day'; });
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 375, height: 667 } : { width: 901, height: 600 });
  const contrast = await settingsTextContrast(page.locator('dialog.history-saves'));
  expect(contrast.rows.length).toBeGreaterThan(0);
  expect(contrast.failures).toEqual([]);
  expect(contrast.controlFailures).toEqual([]);
  await writeFile(info.outputPath('day-contrast.json'), JSON.stringify(contrast, null, 2));
  await page.screenshot({ path: info.outputPath('preview-day-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭资料界面' }).click(); await open(page);
  expect(await read(page)).toEqual(before); expect(server.calls).toEqual([]);
});

test('手动收藏命名重开改名删除，完整状态导出，确认后单次三阶段且连续推进两回合', async ({ page }, info) => {
  await seed(page); const server = await mock(page); await open(page);
  await page.getByRole('button', { name: '保存当前正式节点' }).click();
  await page.getByLabel('历史收藏名称').fill('重要谈判前'); await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(page.locator('.history-node-list')).toContainText('重要谈判前');
  const saved = await read(page); expect(saved.history.nodes.filter((n: { kind: string }) => n.kind === 'manual')).toHaveLength(1);
  await page.reload(); await open(page); await page.getByRole('button', { name: '手动收藏', exact: true }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click(); await page.getByLabel('历史收藏名称').fill('谈判前收藏');
  await page.getByRole('button', { name: '保存名称', exact: true }).click(); await expect(page.locator('.history-node-list')).toContainText('谈判前收藏');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出节点备份' }).click();
  expect((await downloaded).suggestedFilename()).toContain('.heijin.json');
  await page.getByRole('button', { name: '自动历史', exact: true }).click(); await choose(page, 2); await confirm(page);
  await expect(page.locator('.game-layout')).toBeVisible(); await expect.poll(async () => (await read(page)).state.turnNumber).toBe(3);
  expect(server.calls).toEqual(['story', 'variables', 'world']); expect((await read(page)).undo.available).toBe(1);
  await page.getByLabel('你的行动', { exact: true }).fill('继续去公园散步'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(4);
  expect(server.calls).toEqual(['story', 'variables', 'world', 'story', 'variables', 'world']);
  const fresh = await read(page); expect(fresh.undo.available).toBe(2); expect(fresh.raw.records.turnReceipts).toHaveLength(2);
  expect(fresh.history.nodes.find((n: { kind: string }) => n.kind === 'manual').oldTimeline).toBe(true);
  await page.reload(); expect((await read(page)).state).toEqual(fresh.state); expect(server.calls).toHaveLength(6);
  await page.goto('/'); await open(page); await page.getByRole('button', { name: '手动收藏', exact: true }).click();
  await expect(page.locator('.history-node-list')).toContainText('旧时间线收藏'); await page.screenshot({ path: info.outputPath('old-timeline-collection.png') });
  await page.getByRole('button', { name: '删除收藏', exact: true }).click(); await page.getByRole('button', { name: '保留收藏', exact: true }).click();
  expect((await read(page)).history.nodes.filter((n: { kind: string }) => n.kind === 'manual')).toHaveLength(1);
  await page.getByRole('button', { name: '删除收藏', exact: true }).click(); await page.getByRole('button', { name: '确认删除收藏', exact: true }).click();
  await expect(page.getByText('尚未保存手动收藏。')).toBeVisible(); expect((await read(page)).state).toEqual(fresh.state);
});

test('确认后正文失败保留历史基线及输入；刷新不自动请求，主动恢复后正式结算', async ({ page }, info) => {
  await seed(page); const server = await mock(page); server.control.failStory = true;
  await open(page); await choose(page, 2); await confirm(page);
  await expect.poll(async () => (await read(page)).draft?.stageStatus.story).toBe('failed');
  const failure = await read(page); expect(failure.state.turnNumber).toBe(2); expect(failure.undo.available).toBe(0); expect(failure.draft.userInput).toBe('改去公园走走');
  expect(server.calls).toEqual(['story']); await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  expect((await read(page)).raw).toEqual(failure.raw); expect(server.calls).toEqual(['story']);
  await page.screenshot({ path: info.outputPath('restored-failure.png') });
  server.control.failStory = false;
  await page.getByLabel('你的行动', { exact: true }).fill('重新在公园散步'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(3);
  expect(server.calls).toEqual(['story', 'story', 'variables', 'world']);
});

test('已合并主干的纯小说设置在历史回溯后仍只请求正文并正式结算一次', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { settingsKey } = await import(path);
    const settings = JSON.parse(localStorage.getItem(settingsKey)!);
    settings.runtime.useVariableStage = false; settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  });
  await page.reload(); const server = await mock(page); await open(page); await choose(page, 2);
  const expectedClock = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try {
      const node = (await repo.history.list('save-a')).nodes.find((n: { turnNumber: number }) => n.turnNumber === 2);
      const preview = await repo.history.preview('save-a', node); repo.history.release(preview.confirmation); return preview.state.worldClock;
    } finally { repo.close(); }
  });
  await confirm(page);
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(3);
  const result = await read(page);
  expect(server.calls).toEqual(['story']); expect(result.state.worldClock).toBe(expectedClock);
  expect(result.undo.available).toBe(1); expect(result.raw.records.turnReceipts).toHaveLength(1);
  expect(result.draft.useVariableStage).toBe(false); expect(result.draft.useWorldStage).toBe(false);
});

test('跨标签正在生成和无 Web Locks 保守拒绝覆盖，零额外请求', async ({ page, context }) => {
  await seed(page); const server = await mock(page); await open(page); await choose(page, 2);
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => { void navigator.locks.request('heijin.turn:save-a', () => new Promise<void>(resolve => { (window as unknown as { releaseHistoryLock: () => void }).releaseHistoryLock = resolve; })); });
  await expect.poll(() => other.evaluate(() => Boolean((window as unknown as { releaseHistoryLock?: () => void }).releaseHistoryLock))).toBe(true);
  const before = await read(page); await confirm(page); await expect(page.getByRole('alert')).toContainText('其他标签');
  expect(await read(page)).toEqual(before); expect(server.calls).toEqual([]);
  await other.evaluate(() => (window as unknown as { releaseHistoryLock: () => void }).releaseHistoryLock()); await other.close();
  await choose(page, 2); await page.evaluate(() => { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); });
  await confirm(page); await expect(page.getByRole('alert')).toContainText('跨标签互斥');
  expect(await read(page)).toEqual(before); expect(server.calls).toEqual([]);
});

test('旧预览冲突、保存配额失败和正式删除：无部分记录或孤儿', async ({ page, context }) => {
  await seed(page); const server = await mock(page); await open(page); await choose(page, 2);
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), r = await SaveRepository.open();
    try { const g = await r.loadGame('save-a'); await r.bindTurnAction(g.draft, '另一标签已绑定', true, true); } finally { r.close(); }
  });
  const before = await read(page); await confirm(page); await expect(page.getByRole('alert')).toContainText('已改变'); expect(await read(page)).toEqual(before);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function(...args) {
      if (this.name === 'historyPayloads') throw new DOMException('synthetic quota', 'QuotaExceededError'); return add.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '保存当前正式节点' }).click(); await page.getByLabel('历史收藏名称').fill('满额'); await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('空间不足'); expect((await read(page)).history.manualBytes).toBe(0); expect((await read(page)).raw).toEqual(before.raw);
  await page.reload(); await open(page); await page.getByRole('button', { name: '保存当前正式节点' }).click(); await page.getByLabel('历史收藏名称').fill('随存档删除'); await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await expect(page.locator('.history-node-list')).toContainText('随存档删除'); await page.getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click(); await expect(page.getByRole('dialog', { name: '删除这份存档？' })).toContainText('手动收藏');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), r = await SaveRepository.open(); try { return (await r.list()).length; } finally { r.close(); }
  })).toBe(0); expect(server.calls).toEqual([]); await other.close();
});

test('真实浏览器容量、后台压缩响应与大量元数据分页（合成数据）', async ({ page }, info) => {
  test.setTimeout(120000); await seed(page, 2); const server = await mock(page);
  const metrics = await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', gp = '/src/domain/state.ts';
    const { SaveRepository } = await import(rp), { GameStateSchema } = await import(gp), repo = await SaveRepository.open();
    const base = await repo.load('save-a'), rows = [];
    try {
      for (const count of [10, 100, 300, 1000]) {
        const state = structuredClone(base); state.journal = Array.from({ length: count }, (_, i) => ({
          ...base.journal[0], turnId: `synthetic-${i}`, revision: i + 1,
          story: { ...base.journal[0].story, narrative: `合成第${i + 1}回。` + '城市日常经历、人物交流及有据可查的选择。'.repeat(150) },
        })); state.turnNumber = count; state.revision = count; state.appliedCommands = []; state.memories.short = [];
        GameStateSchema.parse(state);
        await new Promise<void>((resolve, reject) => { const open = indexedDB.open('heijinwangchao'); open.onsuccess = () => {
          const db = open.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        }; });
        let frames = 0, last = performance.now(), maxTimerGapMs = 0, sampledPeakHeap = 0;
        const beat = setInterval(() => { frames++; const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - last); last = now; sampledPeakHeap = Math.max(sampledPeakHeap, (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0); }, 5), start = performance.now();
        const node = await repo.history.create('save-a', `容量合成${count}`), saved = performance.now();
        const preview = await repo.history.preview('save-a', { kind: 'manual', id: node.id }), loaded = performance.now();
        clearInterval(beat); repo.history.release(preview.confirmation);
        if (JSON.stringify(preview.state) !== JSON.stringify(state)) throw new Error('lossless check failed');
        rows.push({ turns: count, rawBytes: node.rawBytes, recordBytes: node.bytes, encoding: node.encoding,
          saveMs: saved - start, readMs: loaded - saved, timerTicks: frames, maxTimerGapMs: Math.max(maxTimerGapMs, performance.now() - last), sampledPeakHeap, heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null });
      }
      // Many independent small nodes: metadata pagination must not decode each one.
      const op = indexedDB.open('heijinwangchao'); await new Promise<void>(resolve => { op.onsuccess = () => { const db = op.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(base); tx.oncomplete = () => { db.close(); resolve(); }; }; });
      for (let i = 0; i < 22; i++) await repo.history.create('save-a', `分页收藏${i}`);
    } finally { repo.close(); }
    return rows;
  });
  await writeFile(info.outputPath('browser-capacity.json'), JSON.stringify({ project: info.project.name, viewport: page.viewportSize(), metrics }, null, 2));
  await info.attach('browser-capacity.json', { body: JSON.stringify({ project: info.project.name, viewport: page.viewportSize(), metrics }, null, 2), contentType: 'application/json' });
  expect(metrics).toHaveLength(4); expect(metrics.every(m => m.recordBytes < m.rawBytes && m.timerTicks > 0)).toBe(true);
  await open(page); await page.getByRole('button', { name: '手动收藏', exact: true }).click();
  await expect(page.locator('.history-node-list > li')).toHaveCount(20); await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.history-node-list > li')).toHaveCount(6); expect(server.calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('collections-page2.png') });
});

test('断点续写草稿在历史浏览、取消和刷新后保持原样；只有主动续写才请求', async ({ page }) => {
  await seed(page, 3); const server = await mock(page);
  await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts'; const { SaveRepository } = await import(rp), repo = await SaveRepository.open();
    try { const game = await repo.loadGame('save-a'), bound = await repo.bindTurnAction(game.draft, '正在公园散步', true, true);
      await repo.saveDraft({ ...bound, draftRevision: bound.draftRevision + 1, stageStatus: { ...bound.stageStatus, story: 'failed' },
        failures: [{ stage: 'story', storyRevision: bound.storyRevision, attempt: 1, errorCode: 'output_limit', retryable: false }],
        storyPartial: { text: '<thinking>合成续写</thinking><正文>【旁白】主角来到公园，沿着小路', storyRevision: bound.storyRevision, continuations: 0 } }, bound.draftRevision);
    } finally { repo.close(); }
  });
  const before = await read(page); await open(page); await choose(page, 1);
  await page.getByRole('button', { name: '关闭资料界面' }).click(); await page.reload();
  expect((await read(page)).raw).toEqual(before.raw); expect(server.calls).toEqual([]);
  await page.goto('/#game/save-a'); await expect(page.locator('.game-layout')).toBeVisible();
  await expect(page.getByRole('button', { name: /续写正文/ }).first()).toBeEnabled();
  expect((await read(page)).draft.storyPartial).toEqual(before.draft.storyPartial); expect(server.calls).toEqual([]);
});

test('从历史根重新积累五个恢复点，UI 连续五次撤回后不能越界', async ({ page }) => {
  await seed(page); const server = await mock(page); await open(page); await choose(page, 2); await confirm(page);
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(3);
  await page.goto('/');
  await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', fp = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(rp), { completeDraft, elapsedVariables, submission } = await import(fp), repo = await SaveRepository.open();
    try { for (let i = 0; i < 5; i++) { const game = await repo.loadGame('save-a'); await repo.bindTurnAction(game.draft, `新的合成回合${i}`, true, true);
      await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '经过时间', 60) }), '')); } }
    finally { repo.close(); }
  });
  await page.goto('/#game/save-a'); await expect(page.locator('.game-layout')).toBeVisible();
  for (let count = 5; count >= 1; count--) {
    await page.getByRole('button', { name: `撤回（${count}）`, exact: true }).click();
    await page.getByRole('button', { name: '确认撤回', exact: true }).click();
    await expect.poll(async () => (await read(page)).undo.available).toBe(count - 1);
  }
  await expect(page.getByRole('button', { name: '撤回', exact: true })).toBeDisabled();
  expect((await read(page)).state.turnNumber).toBe(3); expect(server.calls).toEqual(['story', 'variables', 'world']);
});
