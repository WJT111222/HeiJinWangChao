import { openGameTools } from './helpers/gameLayout';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { handoffState, handoffResult, retireCommand, resultText, finishTask } from '../src/tests/fixtures/handoff';
import { event } from '../src/tests/fixtures/game';
import { worldResult, proof } from '../src/tests/fixtures/world';

async function seed(page: Page, variant?: 'mixed-result' | 'unindexed-history' | 'event-report' | 'refused-confirmation') {
  await page.goto('/');
  const before = await page.evaluate(async (variant) => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/handoff.ts', turnPath = '/src/tests/fixtures/turn.ts',
      configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { SaveRepository } = await import(repoPath), { handoffState } = await import(fixturePath), { completeDraft, elapsedVariables } = await import(turnPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://handoff.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-only-secret');
    const initial = handoffState();
    if (variant === 'mixed-result') {
      initial.tasks.work.status = 'completed';
      initial.tasks.work.resolution = { at: initial.worldClock, outcome: 'success', result: '同事归档了一份未经核实的举报：蓝仓暗格藏着违禁货物。', reason: '登记完成', sourceTurnId: 'past',
        resultKnowledge: { facts: ['同事归档了一份举报。'], reported: ['蓝仓暗格藏着违禁货物。'], suspected: [] } };
    }
    if (variant === 'event-report') initial.events.report = { id: 'report', title: '举报受理', status: 'resolved', startAt: initial.worldClock,
      resolvedAt: initial.worldClock, resolutionText: '同事归档了一份举报，未经核实的内容为：蓝仓暗格藏着违禁货物。',
      actorRefs: [{ kind: 'npc', id: 'npc-a' }], sourceTurnIds: ['past'], linkedTaskIds: [], prerequisites: [], blockers: [], visibility: 'hidden', impact: 'minor',
      resultKnowledge: { facts: ['同事归档了一份举报。'], reported: ['蓝仓暗格藏着违禁货物。'], suspected: [] } };
    if (variant === 'unindexed-history' || variant === 'refused-confirmation') {
      initial.npc['npc-a'].relationshipText = '尚未与主角接触'; initial.npc['npc-a'].affinity = 0;
      initial.contactReviewNpcIds = ['npc-a']; initial.revision = 1; initial.turnNumber = 1;
      initial.journal = [{ turnId: 'past', revision: 1, relatedActorRefs: [], story: { turnKind: 'opening',
        narrative: '主角与同事交换联系方式，约好以后经常联系。', summary: '与同事建立联系。', variableGuide: [] } }];
    }
    const repo = await SaveRepository.open();
    if (variant === 'unindexed-history' || variant === 'refused-confirmation') {
      // 隔离的旧档夹具：创建接口禁止伪装已提交的新游戏，直接种入真实V2格式后验证迁移读取。
      await repo.create(handoffState());
      const raw = { ...initial, schemaVersion: 2 }; Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'contactReviewNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs');
      await new Promise<void>((resolve, reject) => { const request = indexedDB.open('heijinwangchao'); request.onsuccess = () => {
        const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      }; request.onerror = () => reject(request.error); });
    } else await repo.create(initial);
    if (variant === 'refused-confirmation') {
      const path = '/src/domain/drafts.ts', { createTurnDraft } = await import(path), state = await repo.load('save-a');
      await repo.saveDraft(createTurnDraft('save-a', state.revision, 'refused-turn', 'regular', '我不确认同事属于非联系人临时人员，先不要删除。'), null);
    }
    const narrative = '主角确认同事属于非联系人临时人员。';
    await completeDraft(repo, variant === 'refused-confirmation' ? { narrative, variables: await elapsedVariables(repo, narrative, 600) } : {});
    const state = await repo.load('save-a'); repo.close(); return state;
  }, variant);
  await page.goto('/#game/save-a'); await openGameTools(page); await page.reload(); await openGameTools(page);
  await expect(page.getByRole('heading', { name: '林舟', exact: true })).toBeVisible(); return before;
}
async function stored(page: Page) { return page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }

test('真实浏览器：世界成果/交接/退场只是候选，主动查看、刷新、正式原子提交后才生效', async ({ page }, info) => {
  const before = await seed(page), state = handoffState(), raw = handoffResult(state); raw.worldCommands = [retireCommand(state)];
  const receiver = raw.taskCommands[0];
  receiver.task.handoff = { ...receiver.task.handoff!, content: '登记号318的三份材料均已核对齐全。',
    summaryBasis: { mode: 'faithful_summary', resultExcerpt: resultText } };
  const transferProof = JSON.parse(receiver.evidence); transferProof.fact = '核对人通过电话传达清单要点。'; receiver.evidence = JSON.stringify(transferProof);
  let calls = 0;
  await page.route('https://handoff.mock.invalid/**', async (route) => { calls++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }) }); });
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText('世界已完成 · 候选未正式结算');
  let saved = await stored(page); expect(saved.state).toEqual(before); expect(saved.state.npc['npc-a']).toBeDefined();
  await expect(page.locator('main')).not.toContainText(resultText);
  await page.getByRole('button', { name: '查看世界候选（未结算）', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '世界候选 · 未正式结算', exact: true });
  await expect(dialog).not.toContainText(resultText); await dialog.getByRole('button', { name: '主动查看完整世界候选', exact: true }).click();
  await expect(dialog.getByLabel('完整世界候选')).toContainText('RetireNpc'); await expect(dialog.getByLabel('完整世界候选')).toContainText(resultText);
  await page.keyboard.press('Escape'); await page.reload(); await openGameTools(page); saved = await stored(page); expect(saved.state).toEqual(before); expect(calls).toBe(1);
  // 用真实存储提交接口隔离本轮新增生命周期的验证，不发送下一轮付费请求。
  const final = await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try {
    const draft = await repo.loadDraft('save-a'); const input = { draft, nextAction: '在街边休息', useVariableStage: true, useWorldStage: true };
    const first = await repo.commitTurn(input), replay = await repo.commitTurn(input); return { first, replay };
  } finally { repo.close(); } });
  expect(final.first.state.npc['npc-a']).toBeUndefined(); expect(final.first.state.retiredNpcs['npc-a'].identityKey).toBe('identity-npc-a');
  expect(final.first.state.tasks.work.resolution.result).toBe(resultText); expect(final.first.state.tasks.next.actorRef.id).toBe('npc-b');
  expect(final.first.state.tasks.next.handoff).toMatchObject({ content: '登记号318的三份材料均已核对齐全。', knowledgeKind: 'reported' });
  expect(final.first.state.journal).toHaveLength(1); expect(final.replay.replayed).toBe(true); expect(final.replay.state).toEqual(final.first.state);
  await page.reload(); await openGameTools(page); await expect(page.locator('main')).not.toContainText(resultText);
  expect((await stored(page)).state).toEqual(final.first.state); expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('world-handoff-committed.png'), fullPage: true });
});

for (const variant of ['event-report', 'refused-confirmation'] as const) test(`第三轮审查${variant}：拒绝信息洗白或否定授权，合法重试及正式提交保持隔离`, async ({ page }) => {
  const before = await seed(page, variant), initial = await stored(page), bad = worldResult(), good = worldResult();
  if (variant === 'event-report') {
    const makeEvent = (text: string) => ({ type: 'SaveEvent' as const, commandId: 'next-event',
      event: { ...event('next-event'), title: '后续归档', actorRefs: [{ kind: 'npc' as const, id: 'npc-b' }], status: 'resolved' as const,
        startAt: before.worldClock, estimatedEndAt: '2026-10-18T08:10:00+08:00', resolvedAt: '2026-10-18T08:05:00+08:00', resolutionText: text, sourceTurnIds: [initial.draft.turnId] },
      evidence: proof({ kind: 'established', sources: ['event:report', 'npc:npc-b'], fact: text }) });
    bad.eventCommands = [makeEvent('蓝仓暗格藏着违禁货物。')]; good.eventCommands = [makeEvent('同事归档了一份举报。')];
  } else {
    const retirement = retireCommand(before), evidence = JSON.parse(retirement.evidence);
    retirement.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: '截取玩家确认片段。', playerConfirmation: '同事属于非联系人临时人员' };
    evidence.kind = 'established'; evidence.fact = '主角确认同事属于非联系人临时人员。'; evidence.sources = ['story:current', 'npc:npc-a']; retirement.evidence = JSON.stringify(evidence);
    bad.worldCommands = [retirement]; bad.taskCommands = [finishTask(before)]; good.taskCommands = [finishTask(before)];
    expect(initial.draft.userInput).toContain('我不确认');
  }
  let calls = 0;
  await page.route('https://handoff.mock.invalid/**', async (route) => { calls++; await route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls === 1 ? bad : good) }, finish_reason: 'stop' }] }) }); });
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  expect((await stored(page)).state).toEqual(before); await page.reload(); await openGameTools(page); expect((await stored(page)).state).toEqual(before);
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText('世界已完成 · 候选未正式结算');
  expect((await stored(page)).state).toEqual(before);
  const committed = await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try {
    const draft = await repo.loadDraft('save-a'), input = { draft, nextAction: '在街边休息', useVariableStage: true, useWorldStage: true };
    return { result: await repo.commitTurn(input), replay: await repo.commitTurn(input) };
  } finally { repo.close(); } });
  expect(committed.result.state.npc['npc-a']).toBeDefined(); expect(committed.result.state.retiredNpcs['npc-a']).toBeUndefined(); expect(committed.replay.replayed).toBe(true);
  if (variant === 'event-report') expect(committed.result.state.events['next-event'].resolutionText).toBe('同事归档了一份举报。');
  else expect(committed.result.state.contactReviewNpcIds).toContain('npc-a');
  await page.reload(); await openGameTools(page); await expect(page.locator('main')).not.toContainText('蓝仓暗格'); expect((await stored(page)).state).toEqual(committed.result.state); expect(calls).toBe(2);
});

for (const variant of ['mixed-result', 'unindexed-history'] as const) test(`第二轮审查${variant}：越权候选拒绝，正式状态不变，可安全重试`, async ({ page }) => {
  const before = await seed(page, variant), draft = (await stored(page)).draft;
  const bad = worldResult(), good = worldResult();
  if (variant === 'mixed-result') {
    const makeEvent = (text: string) => ({ type: 'SaveEvent' as const, commandId: 'world-event',
      event: { ...event('world-event'), title: '场外事实', actorRefs: [{ kind: 'npc' as const, id: 'npc-a' }], status: 'resolved' as const,
        startAt: before.worldClock, estimatedEndAt: '2026-10-18T08:10:00+08:00', resolvedAt: '2026-10-18T08:05:00+08:00', resolutionText: text, sourceTurnIds: [draft.turnId] },
      evidence: proof({ kind: 'established', sources: ['task:work'], fact: text }) });
    bad.eventCommands = [makeEvent('蓝仓暗格藏着违禁货物。')]; good.eventCommands = [makeEvent('同事归档了一份举报。')];
  } else {
    bad.worldCommands = [{ ...retireCommand(before), contactReview: { conclusion: 'non_contact', basis: 'no_known_connection', reason: '结构化索引未发现联系。' } }];
    bad.taskCommands = [finishTask(before)]; good.taskCommands = [finishTask(before)];
  }
  let calls = 0;
  await page.route('https://handoff.mock.invalid/**', async (route) => { calls++; await route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls === 1 ? bad : good) }, finish_reason: 'stop' }] }) }); });
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click(); await expect(page.getByRole('alert')).toBeVisible();
  expect((await stored(page)).state).toEqual(before); await expect(page.locator('main')).not.toContainText('蓝仓暗格');
  await page.reload(); await openGameTools(page); expect((await stored(page)).state).toEqual(before);
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText('世界已完成 · 候选未正式结算');
  const saved = await stored(page); expect(saved.state).toEqual(before); expect(saved.state.npc['npc-a']).toBeDefined(); expect(calls).toBe(2);
  if (variant === 'mixed-result') expect(saved.draft.world.result.eventCommands[0].event.resolutionText).toBe('同事归档了一份举报。');
  else expect(saved.draft.world.result.worldCommands).toEqual([]);
});

test('联系人标签来自真实持久数据，刷新后档案仍保留', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try {
    await repo.save('save-a', 0, 'contact-fixture', [{ type: 'RegisterContact', commandId: 'contact', npcId: 'scene', reason: '隔离UI测试的明确联络设定', evidence: '主角与现场人物交换了联络方式。' }]);
  } finally { repo.close(); } });
  await page.reload(); await openGameTools(page); await page.getByRole('button', { name: /NPC/ }).click();
  const panel = page.getByRole('dialog'); await panel.getByRole('button', { name: /现场人物/ }).click();
  await expect(panel).toContainText('联系人 · 永久保留档案');
  await page.keyboard.press('Escape'); await page.reload(); await openGameTools(page);
  expect((await stored(page)).state.contactNpcIds).toContain('scene');
});


test('V3预览误标的NPC迁移后显示待确认身份，不冒充联系人且不自动删除', async ({ page }) => {
  const before = await seed(page);
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    const state = await repo.load('save-a'); repo.close();
    const raw = { ...state, schemaVersion: 3, contactNpcIds: Object.keys(state.npc) }; Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    await new Promise<void>((resolve, reject) => { const request = indexedDB.open('heijinwangchao'); request.onsuccess = () => {
      const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    }; request.onerror = () => reject(request.error); });
  });
  await page.reload(); await openGameTools(page); await page.getByRole('button', { name: /NPC/ }).click();
  const panel = page.getByRole('dialog'); await panel.getByRole('button', { name: /现场人物/ }).click();
  await expect(panel).toContainText('旧档联系人身份待确认 · 暂缓清理');
  await expect(panel).not.toContainText('联系人 · 永久保留档案');
  const migrated = (await stored(page)).state; expect(migrated.schemaVersion).toBe(4); expect(migrated.contactNpcIds).toEqual([]);
  expect(migrated.contactReviewNpcIds).toContain('scene'); expect(migrated.npc).toEqual(before.npc); expect(migrated.revision).toBe(before.revision);
  await page.reload(); await openGameTools(page); expect((await stored(page)).state).toEqual(migrated);
});
