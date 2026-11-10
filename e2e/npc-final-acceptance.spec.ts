import { test, expect } from './helpers/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedRoster, openNpcRoster, selectNpc, closeNpcRoster, rosterGame } from './helpers/npcRoster';
import { fullPrivateProfile } from '../src/tests/fixtures/npcUnified';

test('千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求', async ({ page }, info) => {
  test.setTimeout(90000);
  let calls = 0; await page.route('https://summary.mock.invalid/**', async r => { calls++; await r.abort(); });
  await seedRoster(page);
  await page.evaluate(async () => {
    const paths = ['/src/tests/fixtures/npcAcceptance.ts', '/src/domain/drafts.ts'];
    const [{ npcAcceptanceState }, { createTurnDraft }] = await Promise.all(paths.map(p => import(p))), state = npcAcceptanceState(1000, 300);
    await new Promise<void>((resolve, reject) => { const open = indexedDB.open('heijinwangchao'); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result, tx = db.transaction(['saves', 'drafts'], 'readwrite');
      tx.objectStore('saves').put(state); tx.objectStore('drafts').put(createTurnDraft(state.saveId, state.revision, 'large-next', 'regular', ''));
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; });
  });
  await page.reload(); const before = await rosterGame(page), metrics = [];
  const widths = info.project.name === 'desktop' ? [1280, 1440, 1650] : [320, 360, 390];
  mkdirSync('docs/assets/npc-v2-final', { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 900 : 844 });
    const start = performance.now(), dialog = await openNpcRoster(page);
    await expect(dialog.getByRole('heading', { name: '人物名录 1000', exact: true })).toBeVisible();
    const list = dialog.getByRole('list', { name: '人物名录', exact: true }); await expect(list.locator(':scope > li')).toHaveCount(20);
    if (width === widths.at(-1)) await page.screenshot({ path: `docs/assets/npc-v2-final/${info.project.name}-roster.png` });
    const openedMs = performance.now() - start, searchStart = performance.now();
    await dialog.getByLabel('搜索人物', { exact: true }).fill('合成别名999'); await expect(list.locator(':scope > li')).toHaveCount(1);
    await expect(list).toContainText('合成人物999'); const searchMs = performance.now() - searchStart;
    let detail = await selectNpc(page, '合成人物999'); await expect(detail).toContainText('本人亲历');
    const back = detail.getByRole('button', { name: '← 返回人物名录', exact: true });
    if (await back.isVisible()) await back.click();
    await dialog.getByLabel('搜索人物', { exact: true }).fill('');
    await dialog.getByLabel('人物筛选', { exact: true }).selectOption('special');
    expect(await list.locator(':scope > li').count()).toBeGreaterThan(0);
    await dialog.getByLabel('人物筛选', { exact: true }).selectOption('all');
    const switchStart = performance.now(); detail = await selectNpc(page, '林澄');
    await expect(detail).toContainText('假日会修理旧家具'); const switchMs = performance.now() - switchStart;
    if (width === widths[0]) await page.screenshot({ path: `docs/assets/npc-v2-final/${info.project.name}-ordinary.png` });
    detail = await selectNpc(page, '许岸'); await expect(detail).toContainText('尚未确认');
    for (const value of Object.values(fullPrivateProfile)) if (typeof value === 'string') expect(await detail.locator('.detail dd').allTextContents()).toContain(value);
    const star = detail.getByRole('button', { name: '取消特殊身份：许岸', exact: true }), box = await star.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    if (width === widths[1]) {
      await page.screenshot({ path: `docs/assets/npc-v2-final/${info.project.name}-special.png` });
      await detail.getByRole('heading', { name: '人物关系网', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/assets/npc-v2-final/${info.project.name}-relationships.png` });
    }
    const memories = detail.getByRole('region', { name: '人物记忆与总结', exact: true });
    await expect(memories).toContainText('44 条记录'); await memories.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(memories).toContainText('第 2 页'); await memories.getByText('来源与认知', { exact: true }).first().click();
    await expect(memories).toContainText('第');
    await detail.evaluate(el => { el.scrollTop = el.scrollHeight; });
    if (width === widths[1]) await page.screenshot({ path: `docs/assets/npc-v2-final/${info.project.name}-long-memory.png` });
    await detail.getByRole('button', { name: '林澄', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '林澄', exact: true })).toBeVisible();
    await expect(info.project.name === 'mobile' ? back : detail.getByRole('heading', { name: '林澄', exact: true })).toBeFocused();
    const geometry = await dialog.evaluate(el => { const list = el.querySelector('.npc-directory')!.getBoundingClientRect(), detail = el.querySelector('.npc-detail')!.getBoundingClientRect(); return { viewportWidth: innerWidth, dialogWidth: el.clientWidth, scrollWidth: el.scrollWidth, list: { x: list.x, right: list.right, width: list.width }, detail: { x: detail.x, width: detail.width } }; });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.dialogWidth + 1);
    if (info.project.name === 'desktop') { expect(geometry.list.right).toBeLessThanOrEqual(geometry.detail.x + 1); expect(geometry.detail.width).toBeGreaterThan(500); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    metrics.push({ width, openedMs, searchMs, switchMs, geometry });
    await closeNpcRoster(page);
  }
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 390, height: 540 }); // available-height stress, not a physical OS keyboard
    const dialog = await openNpcRoster(page); await dialog.getByLabel('搜索人物', { exact: true }).focus();
    await expect(dialog.getByLabel('搜索人物', { exact: true })).toBeInViewport();
    await selectNpc(page, '许岸'); await expect(dialog.getByRole('button', { name: '← 返回人物名录', exact: true })).toBeInViewport();
    await closeNpcRoster(page);
  }
  expect(await rosterGame(page)).toEqual(before); expect(calls).toBe(0);
  writeFileSync(`docs/assets/npc-v2-final/${info.project.name}-ui-metrics.json`, JSON.stringify({ note: 'Playwright end-to-end latency, includes automation waits and process communication; not JS execution time or real-device keyboard validation.', metrics }, null, 2));
});

test('真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock', async ({ page }) => {
  test.setTimeout(90000);
  let round = 0; const calls: string[] = [];
  await page.route('https://summary.mock.invalid/**', async route => {
    const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
    const context = JSON.parse(body.messages.find((m: { content: string }) => m.content.startsWith('<GAME_CONTEXT>')).content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length));
    const state = context.SAVE_STATE;
    expect(context.NPC_KNOWLEDGE).toBeUndefined(); expect(context.SCENE_NPCS).toBeUndefined();
    if (stage === 'story') {
      if (round === 3) expect(state.npc.guest.memories.map((m: { text: string }) => m.text)).toContain('场外核验已完成');
      const narrative = ['林遥介绍了姓名与持续合作的职责，无名路人随后离开。', '林遥改名为林知遥，开始担任协调员并离开现场核验资料。', '主角留在工作室整理资料，场外合作继续推进。', '林知遥带着场外核验经历回到工作室，与主角确认新的合作关系。'][round];
      const content = `<thinking>保持人物与世界连续。</thinking><正文>【旁白】${narrative}</正文><短期记忆>${narrative}</短期记忆><变量规划>[]</变量规划>`;
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` }); return;
    }
    if (stage === 'variables') {
      const set = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
      const memory = `push npc[guest].memories = ${JSON.stringify({ text: `第${round + 1}轮合作亲历`, knowledgeKind: 'observed', knowledgeSource: '本人在场经历', visibility: 'npc_private' })}`;
      const lines = [set('worldClock', new Date(Date.parse(state.worldClock) + 60000).toISOString())];
      if (!round) lines.push(set('npc[guest]', { kind: 'ordinary', identityKey: 'guest-stable', name: '林遥', aliases: [], age: 28, gender: 'female', identity: '合作伙伴', skills: [], onScene: true, affinity: 25, relationshipText: '初步接触', locationId: 'chongqing', memories: [], knownInformation: [] }), memory);
      if (round === 1) lines.push(set('npc[guest].specialProfile', { detailedBackground: '在社区成长，学习协调合作。', activeGoals: ['核验资料'], habits: ['保留记录'], offscreenTaskIds: [], relationshipNetwork: [] }), set('npc[guest].privateProfile', fullPrivateProfile), set('npc[guest].name', '林知遥'), set('npc[guest].aliases', ['林遥']), set('npc[guest].identity', '协调员'), memory, set('npc[guest].onScene', false));
      if (round === 3) lines.push(set('npc[guest].onScene', true), set('npc[guest].relationshipText', '经过合作更加信任'), set('npc[guest].affinity', 40), memory);
      await route.fulfill({ json: { choices: [{ message: { content: `<thinking>记录当前事实。</thinking><说明></说明><命令>\n${lines.join('\n')}\n</命令>` }, finish_reason: 'stop' }] } }); return;
    }
    expect(state.revision).toBe(context.BASE_SAVE_REVISION);
    const world = { worldCommands: [] as unknown[], taskCommands: [] as unknown[], eventCommands: [], visibleHooks: [], unresolved: [] };
    if (round === 1) {
      expect(context.PROTECTED_SCENE.sceneNpcIds).not.toContain('guest');
      world.taskCommands.push({ type: 'SaveTask', commandId: 'new-work', evidence: '离场核验', task: { id: 'guest-duty', actorRef: { kind: 'npc', id: 'guest' }, goal: '核验工作资料', status: 'active', startAt: state.worldClock, dueAt: new Date(Date.parse(state.worldClock) + 3600000).toISOString(), prerequisites: [], blockers: [] } });
    }
    if (round === 2) {
      world.taskCommands.push({ type: 'SaveTask', commandId: 'finish-work', evidence: '独立核验结束', task: { ...state.tasks['guest-duty'], status: 'completed', resolution: { at: state.worldClock, outcome: 'success', result: '场外核验已完成', reason: '完成职责', sourceTurnId: context.TURN_CONTEXT.turnId } } });
      world.worldCommands.push({ type: 'RecordNpcMemory', commandId: 'offscene-memory', npcId: 'guest', expectedRevision: state.revision, knowledgeKind: 'observed', addToKnownInformation: false, evidence: '独立工作经历', memory: { id: 'guest-offscene-memory', text: '场外核验已完成', knowledgeSource: '本人处理', visibility: 'npc_private', createdAtGameTime: state.worldClock, sourceTurnIds: [context.TURN_CONTEXT.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'guest' }] } });
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(world) }, finish_reason: 'stop' }] } });
  });
  await seedRoster(page); const before = await rosterGame(page);
  for (round = 0; round < 4; round++) {
    await page.getByLabel('你的行动', { exact: true }).fill(`第${round + 1}次合作`); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await rosterGame(page)).state.turnNumber, { timeout: 20000 }).toBe(before.state.turnNumber + round + 1);
    // Successful commit clears the action; the send button correctly stays disabled until new input.
    await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  }
  const final = await rosterGame(page); expect(Object.keys(final.state.npc)).toHaveLength(4);
  expect(final.state.npc.guest).toMatchObject({ identityKey: 'guest-stable', name: '林知遥', identity: '协调员', affinity: 40, onScene: true, privateProfile: fullPrivateProfile });
  expect(final.state.npc.guest.memories).toHaveLength(4); expect(final.state.tasks['guest-duty']).toMatchObject({ status: 'completed', actorRef: { id: 'guest' } });
  await openNpcRoster(page); const detail = await selectNpc(page, '林知遥'); await expect(detail).toContainText('场外核验已完成');
  await detail.getByRole('button', { name: '取消特殊身份：林知遥', exact: true }).click(); await expect(detail).not.toContainText('香闺秘档');
  await detail.getByRole('button', { name: '设为特殊人物：林知遥', exact: true }).click(); await expect(detail.getByRole('heading', { name: '香闺秘档', exact: true })).toBeVisible();
  expect((await rosterGame(page)).state.npc.guest).toMatchObject({ privateProfile: fullPrivateProfile, importancePreference: 'special' });
  await closeNpcRoster(page); await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  expect((await rosterGame(page)).state.npc.guest.memories).toEqual(final.state.npc.guest.memories);
  expect(calls).toEqual(Array.from({ length: 4 }, () => ['story', 'variables', 'world']).flat());
});
