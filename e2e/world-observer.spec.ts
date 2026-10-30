import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/src/tests/fixtures/npcMemory.ts', data = '/src/tests/fixtures/game.ts', memory = '/src/domain/memories/npcMemory.ts',
      storage = '/src/services/storage/saveRepository.ts';
    const { npcMemoryState, npcSummaryOutput } = await import(fixture), { event, task, organizations } = await import(data),
      { planNpcSummary, parseNpcSummary, applyNpcSummary } = await import(memory), { SaveRepository } = await import(storage);
    let state = npcMemoryState(31, true);
    const batch = planNpcSummary(state)!;
    state = applyNpcSummary(state, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'observer-summary'));
    const person = state.npc['npc-a'];
    person.identity = '诊所医师'; person.healthText = '健康';
    person.memories.push({ id: 'suspected', text: '[推测]北仓可能缺货', knowledgeKind: 'suspected', knowledgeSource: '个人猜测，尚未核实',
      visibility: 'npc_private', sourceTurnIds: [], affectedEntityRefs: [{ kind: 'npc', id: person.id }], createdAtGameTime: state.worldClock });
    person.knownInformation.push({ text: '已经收到同事的通知', source: '同事口头转述', learnedAt: state.worldClock });
    state.memories.medium.push({ id: 'world-internal', text: '仅内部保存的仓库背景', sourceTurnIds: [], affectedEntityRefs: [], visibility: 'internal', createdAtGameTime: state.worldClock });
    state.organizations['org-a'] = { ...organizations[3], description: '独立经营诊所', operatingStatus: '正常营业' };
    for (const visibility of ['hidden', 'partially_known']) {
      const id = `event-${visibility}`;
      state.events[id] = { ...event(id), title: `${visibility}检查排程`, status: 'active', visibility,
        actorRefs: [{ kind: 'organization', id: 'org-a' }], impact: 'significant', sourceTurnIds: [], estimatedEndAt: '2026-10-20T08:00:00+08:00' };
    }
    state.tasks.job = { ...task('job'), goal: '诊所场外盘点任务', actorRef: { kind: 'npc', id: person.id } };
    const repo = await SaveRepository.open(); repo.close();
    // 隔离的既有多回合档案夹具；不能冒充新游戏绕过create的未提交约束。
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    });
  });
  await page.goto('/#game/save-a'); await openGameTools(page);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const storage = '/src/services/storage/saveRepository.ts', ctx = '/src/prompts/context.ts', settings = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storage), { contextFor } = await import(ctx), { defaultSettings } = await import(settings);
    const repo = await SaveRepository.open();
    try { const state = await repo.load('save-a'); return { state, story: contextFor({ state, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: '观察四周' }) }; }
    finally { repo.close(); }
  });
}
test('全量世界观察：场外人物认知、总结、排程、任务与组织只读可查，搜索分页不触发模型', async ({ page }, info) => {
  let requests = 0;
  await page.route('https://**', async route => { requests++; await route.abort(); });
  await seed(page); const before = await snapshot(page);
  const open = async (name: string) => { await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: new RegExp(name) }).click(); return page.getByRole('dialog', { name, exact: true }); };
  let panel = await open('NPC');
  await panel.getByLabel('搜索人物', { exact: true }).fill('未公开人物A');
  await panel.getByRole('button', { name: /未公开人物A/ }).click();
  await expect(panel).toContainText('诊所医师');
  await expect(panel).toContainText('已经收到同事的通知');
  await panel.getByLabel('搜索人物记忆与总结').fill('北仓');
  await expect(panel).toContainText('推测（未确认）'); await expect(panel).toContainText('个人猜测，尚未核实');
  await panel.getByLabel('搜索人物记忆与总结').fill('本组经历');
  await expect(panel).toContainText('本组经历与未了约定被保留');
  await panel.getByText('总结来源与覆盖凭据', { exact: true }).click();
  await expect(panel).toContainText('npc-a-memory-1');
  await panel.getByLabel('搜索人物记忆与总结').fill('');
  await panel.getByRole('region', { name: '人物记忆与总结', exact: true }).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(panel).toContainText('第 2 页');
  await page.screenshot({ path: info.outputPath('npc-observer.png') });
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  panel = await open('记忆');
  await panel.getByRole('button', { name: '人物记忆', exact: true }).click();
  await panel.getByLabel('搜索当前记忆层级').fill('B的独占秘密');
  await expect(panel).toContainText('未公开人物B');
  await panel.getByRole('button', { name: '中期记忆', exact: true }).click();
  await panel.getByLabel('搜索当前记忆层级').fill('');
  await expect(panel).toContainText('仅内部保存的仓库背景');
  await expect(panel).toContainText('内部世界记录 · 不代表任何角色已知');
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  panel = await open('世界事件');
  await expect(panel).toContainText('hidden检查排程'); await expect(panel).toContainText('partially_known检查排程');
  await panel.getByText('全部事件字段与引用', { exact: true }).first().click();
  await expect(panel).toContainText('org-a'); await expect(panel).toContainText('完成预约事项');
  await panel.getByText('任务进展', { exact: true }).click(); await expect(panel).toContainText('诊所场外盘点任务');
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  panel = await open('势力组织'); await expect(panel).toContainText('独立经营诊所');
  await panel.getByText('完整记录', { exact: true }).click(); await expect(panel).toContainText('正常营业');
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  expect(await snapshot(page)).toEqual(before);
  expect(JSON.stringify(before.story)).not.toMatch(/北仓可能缺货|B的独占秘密|仅内部保存的仓库背景|检查排程/);
  expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
