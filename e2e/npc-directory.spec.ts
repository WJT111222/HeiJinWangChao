import { test, expect } from './helpers/test';
import { mkdirSync } from 'node:fs';
import { seedRoster, openNpcRoster, closeNpcRoster, selectNpc, rosterGame, mockRosterTurn } from './helpers/npcRoster';
import { fullPrivateProfile } from '../src/tests/fixtures/npcUnified';

test('统一名录搜索筛选、详情、联系与单向关系、来源无技术ID；双端真实截图', async ({ page }, info) => {
  let calls = 0; await page.route('https://summary.mock.invalid/**', async r => { calls++; await r.abort(); });
  await seedRoster(page); const before = await rosterGame(page), dialog = await openNpcRoster(page);
  const list = dialog.getByRole('list', { name: '人物名录', exact: true });
  await expect(list.locator(':scope > li')).toHaveCount(3);
  await dialog.getByLabel('搜索人物', { exact: true }).fill('阿澄'); await expect(list.locator(':scope > li')).toHaveCount(1);
  await dialog.getByLabel('搜索人物', { exact: true }).fill('记者'); await expect(list).toContainText('周闻');
  await dialog.getByLabel('搜索人物', { exact: true }).fill('');
  await dialog.getByLabel('人物筛选', { exact: true }).selectOption('special'); await expect(list.locator(':scope > li')).toHaveCount(1);
  await dialog.getByLabel('人物筛选', { exact: true }).selectOption('ordinary'); await expect(list.locator(':scope > li')).toHaveCount(2);
  await dialog.getByLabel('人物筛选', { exact: true }).selectOption('all');
  mkdirSync('docs/assets/npc-v2-batch5', { recursive: true });
  await page.screenshot({ path: `docs/assets/npc-v2-batch5/${info.project.name}-roster.png` });
  let detail = await selectNpc(page, '林澄');
  for (const text of ['设计师', '阿澄', '身体良好', '尚未掌握', '当前位置', '测试住宅', '测试工作室', '世界记录／主角未知', '主角已知']) await expect(detail).toContainText(text);
  await expect(detail).not.toContainText('联系人'); await expect(detail).not.toContainText('香闺秘档');
  detail = await selectNpc(page, '周闻'); await expect(detail).toContainText('已失效');
  detail = await selectNpc(page, '许岸');
  for (const text of ['尚未确认', '已掌握联系途径', '好感：-12', '好感：未知', '未建档的旧同学', '人物原始记忆', '人物总结', '维护正式合作记录与工作室安排', '许岸对林澄的好感：-12']) await expect(detail).toContainText(text);
  await page.screenshot({ path: `docs/assets/npc-v2-batch5/${info.project.name}-profile.png` });
  for (const id of [before.state.npc.special.identityKey, 'roster-memory-', 'roster-turn-', 'npcManagementRevision', 'importancePreference']) expect(await detail.innerText()).not.toContain(id);
  await detail.getByText('来源与认知', { exact: true }).first().click(); await expect(detail).toContainText('第 1 回合');
  await page.screenshot({ path: `docs/assets/npc-v2-batch5/${info.project.name}-detail.png` });
  await detail.getByRole('button', { name: '林澄', exact: true }).click(); await expect(detail.getByRole('heading', { name: '林澄', exact: true })).toBeVisible();
  await expect(detail).not.toContainText('好感：-12');
  if (info.project.name === 'desktop') await expect(detail.getByRole('heading', { name: '林澄', exact: true })).toBeFocused();
  else await expect(detail.getByRole('button', { name: '← 返回人物名录', exact: true })).toBeFocused();
  expect(await rosterGame(page)).toEqual(before); expect(calls).toBe(0);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('初始同伴取消及恢复金星，七字段完整、普通记忆不丢、刷新及回填输入保留，零请求', async ({ page }) => {
  let calls = 0; await page.route('https://summary.mock.invalid/**', async r => { calls++; await r.abort(); });
  await seedRoster(page); await page.getByLabel('你的行动', { exact: true }).fill('尚未发送的输入');
  const before = await rosterGame(page); await openNpcRoster(page); const detail = await selectNpc(page, '许岸');
  for (const [field, value] of Object.entries(fullPrivateProfile)) if (typeof value === 'string') {
    const text = await detail.locator('.detail dd').allTextContents(); expect(text, field).toContain(value);
  }
  await detail.getByRole('button', { name: '取消特殊身份：许岸', exact: true }).click();
  await expect(detail.getByRole('button', { name: '设为特殊人物：许岸', exact: true })).toBeVisible();
  for (const text of ['香闺秘档', '特殊人物资料', '在沿江社区成长', '完成长期合作']) await expect(detail).not.toContainText(text);
  const ordinary = await rosterGame(page); expect(ordinary.state.npc.special).toMatchObject({ kind: 'ordinary', importancePreference: 'ordinary' });
  expect(ordinary.state.dormantNpcProfiles!.special.profile.privateProfile).toEqual(fullPrivateProfile);
  expect(ordinary.state.npc.special.memories).toEqual(before.state.npc.special.memories); expect(ordinary.state.memories).toEqual(before.state.memories);
  await detail.getByRole('button', { name: '设为特殊人物：许岸', exact: true }).click();
  await expect(detail.getByRole('heading', { name: '香闺秘档', exact: true })).toBeVisible();
  const restored = await rosterGame(page);
  expect(restored.state.npc.special).toEqual({ ...before.state.npc.special, importancePreference: 'special' });
  expect(restored.state.worldClock).toBe(before.state.worldClock); expect(restored.state.revision).toBe(before.state.revision); expect(restored.state.turnNumber).toBe(before.state.turnNumber);
  await closeNpcRoster(page); await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('尚未发送的输入');
  await page.reload(); await openNpcRoster(page); await selectNpc(page, '许岸');
  expect(await rosterGame(page)).toEqual(restored); expect(calls).toBe(0);
});

test('首次加星只保存待完善；保存中重复点击无效，正式CAS只递增一次', async ({ page }) => {
  await seedRoster(page); await openNpcRoster(page); const detail = await selectNpc(page, '林澄');
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), original = SaveRepository.prototype.setNpcImportance;
    const gate = window as unknown as { releaseNpc: () => void; npcCalls: number }; gate.npcCalls = 0;
    SaveRepository.prototype.setNpcImportance = async function (this: unknown, ...args: Parameters<typeof original>) {
      gate.npcCalls++; await new Promise<void>(resolve => { gate.releaseNpc = resolve; });
      return original.apply(this, args);
    };
  });
  const star = detail.getByRole('button', { name: '设为特殊人物：林澄', exact: true }); await star.click(); await expect(star).toBeDisabled(); await star.dispatchEvent('click');
  await expect(page.getByRole('status').filter({ hasText: '正在保存人物重要性' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseNpc: () => void }).releaseNpc());
  await expect(detail).toContainText('特殊人物资料待完善，将在后续正常剧情的 Variables 阶段尝试补充。');
  expect((await rosterGame(page)).state.npcManagementRevision).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { npcCalls: number }).npcCalls)).toBe(1);
});

test('跨标签过期星标准确失败并同步正式状态，完整候选不丢，无自动重试', async ({ page, context }) => {
  await seedRoster(page, true); const before = await rosterGame(page); await openNpcRoster(page); await selectNpc(page, '林澄');
  const other = await context.newPage(); await other.goto('/#game/save-a'); await openNpcRoster(other); const stale = await selectNpc(other, '林澄');
  await page.getByRole('region', { name: '人物详情', exact: true }).getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click();
  await expect(page.getByRole('region', { name: '人物详情', exact: true }).getByRole('button', { name: '取消特殊身份：林澄', exact: true })).toBeVisible();
  await stale.getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click();
  await expect(other.getByRole('status').filter({ hasText: '本次修改未保存' })).toBeVisible();
  await expect(stale.getByRole('button', { name: '取消特殊身份：林澄', exact: true })).toBeVisible();
  const saved = await rosterGame(other); expect(saved.state.npcManagementRevision).toBe(1);
  for (const field of ['story', 'variables', 'world', 'userInput'] as const) expect(saved.draft![field]).toEqual(before.draft![field]);
  expect(saved.draft!.draftRevision).toBe(before.draft!.draftRevision + 1); await other.close();
});

test('真实Story请求中本页与其他标签管理均拒绝，不取消请求；随后正常三阶段结算', async ({ page, context }) => {
  const mock = await mockRosterTurn(page, true); await seedRoster(page); const before = await rosterGame(page);
  await page.getByLabel('你的行动', { exact: true }).fill('继续交流'); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect.poll(() => mock.calls.length).toBe(1);
  await openNpcRoster(page); const detail = await selectNpc(page, '林澄'); await detail.getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '当前回合正在生成，请完成或取消后再修改人物重要性。' })).toBeVisible();
  const other = await context.newPage(); await other.goto('/#game/save-a'); await openNpcRoster(other); const foreign = await selectNpc(other, '林澄');
  await foreign.getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click(); await expect(other.getByRole('status').filter({ hasText: '当前回合正在生成' })).toBeVisible();
  expect((await rosterGame(page)).state).toEqual(before.state); expect(mock.calls).toEqual(['story']); await other.close();
  await closeNpcRoster(page); mock.release();
  await expect.poll(async () => (await rosterGame(page)).state.turnNumber, { timeout: 20000 }).toBe(before.state.turnNumber + 1);
  expect(mock.calls).toEqual(['story', 'variables', 'world']);
});

test('IndexedDB中途写入失败原子回滚，星标不假成功，候选完整保留', async ({ page }) => {
  await seedRoster(page, true); const before = await rosterGame(page); await openNpcRoster(page); const detail = await selectNpc(page, '林澄');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'drafts') { IDBObjectStore.prototype.put = put; throw new DOMException('synthetic failed draft write', 'QuotaExceededError'); }
      return put.apply(this, args);
    };
  });
  await detail.getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: '人物重要性未保存' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '设为特殊人物：林澄', exact: true })).toBeVisible(); expect(await rosterGame(page)).toEqual(before);
  await page.reload(); expect(await rosterGame(page)).toEqual(before);
});

test('名录只读空状态，以及正式人物消失后的安全返回', async ({ page }) => {
  await seedRoster(page); await openNpcRoster(page); await selectNpc(page, '周闻');
  // Simulate an externally restored lawful world; failed stale management reloads it.
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/domain/state.ts'];
    const [{ SaveRepository }, { GameStateSchema }] = await Promise.all(paths.map(p => import(p))), repo = await SaveRepository.open();
    const state = await repo.load('save-a'); repo.close(); state.npc = {}; state.tasks = {}; delete state.initialCompanionId; state.memories.npcSummaries = {}; state.contactNpcIds = []; state.contactReviewNpcIds = [];
    GameStateSchema.parse(state);
    await new Promise<void>((resolve, reject) => { const req = indexedDB.open('heijinwangchao'); req.onsuccess = () => { const db = req.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; });
  });
  const dialog = page.getByRole('dialog', { name: 'NPC', exact: true });
  await dialog.getByRole('region', { name: '人物详情', exact: true }).getByRole('button', { name: '设为特殊人物：周闻', exact: true }).click();
  await expect(dialog).toContainText('尚无正式人物档案');
  await expect(dialog.getByRole('list', { name: '人物名录', exact: true }).locator('li')).toHaveCount(0);
});
