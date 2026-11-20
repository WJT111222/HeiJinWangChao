import { test, expect } from './helpers/test';
import type { GameState } from '../src/domain/state';
import type { Page } from '@playwright/test';
import { seedSummary, summaryPage, summaryState, summaryWire, requestTask } from './helpers/memorySummary';
import { openWorldArchive } from './helpers/gameLayout';
import { openStoredSave } from './helpers/home';
import { variableReply } from '../src/tests/fixtures/variableReply';

test.describe.configure({ timeout: 60000 });

const summaryName = '短期 → 中期';
const failureDialog = (page: Page) => page.getByRole('dialog', { name: /总结(?:失败|待确认)$/ });
const clickSave = async (page: Page) => {
  await page.getByRole('button', { name: '保存记忆设置', exact: true }).click();
};
const closeSettings = async (page: Page) => { await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭资料界面', exact: true }).click(); };
const closeFailure = async (page: Page) => { await failureDialog(page).getByRole('button', { name: '关闭资料界面', exact: true }).click(); };
const step = async (page: Page) => { await page.clock.fastForward(61000); };
const progress = async (page: Page) => page.evaluate(async () => {
  const repoPath = '/src/services/storage/saveRepository.ts', cPath = '/src/domain/memories/compression.ts', nPath = '/src/domain/memories/npcMemory.ts';
  const vPath = '/src/ui/panels/playerView.ts', recordsPath = '/src/workflows/memorySummaryRecords.ts';
  const { SummaryRecords } = await import(recordsPath);
  const { playerView } = await import(vPath);
  const { SaveRepository } = await import(repoPath), { compressionCandidates } = await import(cPath), { npcSummaryCandidates } = await import(nPath);
  const repo = await SaveRepository.open();
  try {
    const s = await repo.load('save-a');
    const records = new SummaryRecords(localStorage, s);
    return { turn: s.turnNumber, journal: s.journal.length, archived: playerView(s).memoryLayers.short, raw: s.memories.short.length, eligible: compressionCandidates(s, 'short').length,
      mid: s.memories.medium.length, sources: s.memories.medium.flatMap((e: { sourceTurnIds: string[] }) => e.sourceTurnIds),
      npc: ['npc-a','npc-b'].map(id => [id, npcSummaryCandidates(s, id).length, s.memories.npcSummaries[id]?.length ?? 0]),
      failure: records.issues.map(({ kind, code, npcId }: { kind: string; code: string; npcId?: string }) => ({ kind, code, npcId })),
      attempts: records.pending.map(({ kind, npcId, retryId, sourceIds }: { kind: string; npcId?: string; retryId: string; sourceIds?: string[] }) => ({ kind, npcId, retryId, sourceIds })),
      cursor: JSON.parse(localStorage.getItem('heijin.summary.schedule:save-a') || '{}'),
      pending: ['short','medium','npc'].map(kind => records.pending.some((entry: { kind: string }) => entry.kind === kind)) };
  } finally { repo.close(); }
});
function log(tag: string, value: unknown) { console.log(tag + ' ' + JSON.stringify(value)); }
async function intercept(page: Page, mode: 'ok'|'invalid'|'http'|'timeout'|'npc' = 'ok') {
  const memory: { task: string; npcId?: string; ids: string[] }[] = [], story: string[] = [];
  let failNext = mode !== 'ok';
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'blob:') return route.continue();
    if (url.hostname !== 'summary.mock.invalid') return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = req.postDataJSON();
    if (body.model !== 'memory') {
      story.push(body.model);
      const content = body.model === 'story' ? '<正文>主角仍在原地休息，并观察窗外。</正文><短期记忆>在原地观察窗外。</短期记忆><变量规划>[]</变量规划>'
        : body.model === 'variables' ? variableReply({ commands: [], rejectedSuggestions: [], unresolved: [] })
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
      if (body.model === 'story' && body.stream) return route.fulfill({ headers, contentType: 'text/event-stream',
        body: 'data: '+JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n' });
      return route.fulfill({ headers, json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
    }
    const task = requestTask(body);
    const entries = task.entries as { id: string }[] | undefined ??
      (task.groups as { entries: { id: string }[] }[] | undefined)?.flatMap(group => group.entries);
    memory.push({ task: String(task.task), ...(task.npcId ? { npcId: String(task.npcId) } : {}), ids: (entries ?? []).map(e => e.id) });
    if (failNext && (mode !== 'npc' || task.npcId === 'npc-a')) {
      failNext = false;
      if (mode === 'timeout') return; // Keep the browser fetch open until its real timeout aborts it.
      if (mode === 'invalid') return route.fulfill({ headers, json: { choices: [{ message: { content: '{"summary":"缺少事件"}' }, finish_reason: 'stop' }] } });
      return route.fulfill({ headers, status: 503, json: { error: { message: 'mock-key-private-not-to-log' } } });
    }
    return route.fulfill({ headers, json: summaryWire(task) });
  });
  return { memory, story };
}

for (const count of [31,85]) test('默认自动调度及合格短期积压 ' + count, async ({ page }, info) => {
  await page.clock.install();
  const { memory } = await intercept(page);
  await seedSummary(page,{count});
  await expect.poll(async () => (await progress(page)).mid).toBe(1);
  expect(memory).toHaveLength(1);
  const states = [await progress(page)];
  const expected = count === 85 ? 6 : 1;
  for (let i=2;i<=expected;i++) {
    await step(page);
    await expect.poll(async () => (await progress(page)).mid).toBe(i);
    expect(memory).toHaveLength(i);
    states.push(await progress(page));
  }
  await step(page);
  await expect.poll(async () => JSON.stringify((await progress(page)).cursor)).not.toBe(JSON.stringify(states.at(-1)!.cursor));
  const final = await progress(page);
  expect(memory).toHaveLength(expected);
  expect(final).toMatchObject({ raw:count-expected*10, journal:count, archived:count-expected*10, mid:expected, eligible:count-expected*10 });
  expect(new Set(final.sources).size).toBe(expected*10);
  expect(memory.every(task=>task.ids.length===10 && task.task==='memory.short_to_medium')).toBe(true);
  const dialog = await summaryPage(page);
  await expect(dialog.getByRole('region',{name:summaryName,exact:true})).toContainText('当前合格未覆盖：'+ final.eligible + ' 条');
  await page.screenshot({path:info.outputPath('eligible-' + count + '.png')});
  log('SHORT', {count, calls:memory.length, eligible:states.map(s=>s.eligible), raw:final.raw, journal:final.journal, archived:final.archived});
});

for (const mode of ['invalid','http','timeout'] as const) test('真实请求失败、关闭提示、继续及刷新 ' + mode, async ({page},info) => {
  await page.clock.install();
  const { memory, story } = await intercept(page, mode);
  await seedSummary(page,{count:45,ready:mode==='http'});
  await expect.poll(()=>memory.length).toBe(1);
  if (mode === 'timeout') {
    const during = await summaryPage(page);
    await expect(during.getByRole('region', { name: summaryName, exact: true })).toContainText('正在总结');
    await closeSettings(page);
    await page.clock.fastForward(181000);
  }
  await expect(failureDialog(page)).toBeVisible({timeout:10000});
  const failed = await progress(page);
  expect(failed).toMatchObject({ mid:0, raw:45, eligible:45, failure:[{kind:'short', code:mode==='invalid'?'MEMORY_OUTPUT':mode==='http'?'server':'timeout'}],pending:[true,false,false] });
  await closeFailure(page);
  await expect(failureDialog(page)).toHaveCount(0);
  const settings = await summaryPage(page);
  await expect(settings.getByLabel('自动总结 ' + summaryName,{exact:true})).toBeChecked();
  const section = settings.getByRole('region', { name:summaryName, exact:true });
  await expect(section).toContainText('当前合格未覆盖：45 条');
  await expect(section).toContainText('失败待处理');
  await expect(section).toContainText('可能已计费');
  await page.screenshot({path:info.outputPath('enabled-but-blocked.png')});
  await closeSettings(page);
  if (mode==='http') {
    await page.getByLabel('你的行动',{exact:true}).fill('继续观察窗外');
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect.poll(async ()=>(await progress(page)).turn).toBeGreaterThan(45);
    await expect.poll(()=>story.length).toBeGreaterThan(0);
    await expect(failureDialog(page)).toHaveCount(0);
  }
  await step(page);
  await expect.poll(async () => JSON.stringify((await progress(page)).cursor)).not.toBe(JSON.stringify(failed.cursor));
  expect(memory).toHaveLength(1); expect((await progress(page)).mid).toBe(0);
  await page.reload();
  await expect(failureDialog(page)).toContainText('发送行动不会自动重试');
  expect(memory).toHaveLength(1);
  log('FAILED', {mode, failure:failed.failure, pending:failed.pending, turnAfterPlay:(await progress(page)).turn, modelCalls:memory.length, story});
  // Explicit per-job retry retains originals and resumes scheduling.
  await failureDialog(page).getByRole('button',{name:'重新生成',exact:true}).click();
  await expect.poll(async () => (await progress(page)).mid).toBe(1);
  expect(memory).toHaveLength(2); expect((await progress(page)).pending[0]).toBe(false);
  expect(memory[1].ids).toEqual(memory[0].ids);
  await step(page);
  await expect.poll(async () => (await progress(page)).mid).toBe(2);
  expect(memory).toHaveLength(3);
  expect(memory[2].ids.some(id => memory[0].ids.includes(id))).toBe(false);
  expect(new Set((await progress(page)).sources).size).toBe(20);
});

test('暂停并重新开启自动总结保留原批保护，只有主动重试才发送', async ({page}) => {
  await page.clock.install();
  const {memory} = await intercept(page,'http');
  await seedSummary(page,{count:45});
  await expect(failureDialog(page)).toBeVisible();
  const before = await progress(page);
  expect(before.attempts[0].sourceIds).toEqual(memory[0].ids);
  await failureDialog(page).getByRole('button',{name:'暂停自动总结',exact:true}).click();
  await expect(failureDialog(page)).toHaveCount(0);
  expect((await progress(page)).attempts).toEqual(before.attempts);
  const settings = await summaryPage(page), control = settings.getByLabel('自动总结 ' + summaryName,{exact:true});
  await expect(control).not.toBeChecked();
  await expect(settings).toContainText('已暂停自动总结');
  await control.check();
  await clickSave(page);
  await step(page);
  await expect(settings).toContainText('失败待处理');
  expect(memory).toHaveLength(1);
  expect((await progress(page)).attempts).toEqual(before.attempts);
  expect((await progress(page)).sources).toEqual([]);
  await settings.getByRole('button',{name:'重新生成此批（可能计费）',exact:true}).click();
  await expect.poll(async () => (await progress(page)).mid).toBe(1);
  expect(memory).toHaveLength(2);
  expect(memory[0].ids).toEqual(memory[1].ids);
  expect((await progress(page)).attempts).toEqual([]);
  log('REOPEN_GUARD', {beforeExplicitRetry:1, afterExplicitRetry:2, sameBatch:true});
});

test('NPC A失败后B继续，A的原始记忆与付费保护独立保留', async ({page}) => {
  await page.clock.install();
  const {memory} = await intercept(page,'npc');
  await seedSummary(page,{count:31,npcCount:20,secondNpc:true});
  await expect(failureDialog(page)).toContainText('发送行动不会自动重试');
  await expect.poll(async ()=>(await progress(page)).mid).toBe(1);
  const failed = await progress(page);
  expect(failed.npc).toEqual([['npc-a',20,0],['npc-b',20,0]]);
  const npcCalls = () => memory.filter(item=>item.npcId);
  expect(failed.attempts[0]).toMatchObject({ npcId:'npc-a', sourceIds:npcCalls()[0].ids });
  await closeFailure(page);
  await step(page);
  await expect.poll(async ()=>(await progress(page)).npc[1]).toEqual(['npc-b',5,1]);
  expect(npcCalls().map(item=>item.npcId)).toEqual(['npc-a','npc-b']);
  expect(npcCalls()[1].ids.some(id=>npcCalls()[0].ids.includes(id))).toBe(false);
  const state: GameState = await summaryState(page);
  expect(state.npc['npc-b'].memories).toHaveLength(20);
  expect(state.memories.npcSummaries['npc-b'].flatMap(entry=>entry.npcProvenance!.sourceMemoryIds).sort())
    .toEqual([...npcCalls()[1].ids].sort());
  expect((await progress(page)).attempts).toEqual(failed.attempts);
  await page.reload();
  await expect(failureDialog(page)).toBeVisible();
  await failureDialog(page).getByRole('button',{name:'重新生成',exact:true}).click();
  await expect.poll(async ()=>(await progress(page)).npc[0]).toEqual(['npc-a',5,1]);
  expect(npcCalls().map(item=>item.npcId)).toEqual(['npc-a','npc-b','npc-a']);
  expect(npcCalls()[2].ids).toEqual(npcCalls()[0].ids);
  log('NPC_ISOLATION',{order:npcCalls().map(item=>item.npcId), public:(await progress(page)).mid});
});

test('本地预算拦截零发送，修改批次后自动恢复', async ({page}) => {
  await page.clock.install();
  const {memory} = await intercept(page);
  await seedSummary(page,{count:45,automatic:false});
  const state: GameState = await summaryState(page);
  for (const entry of state.memories.short.slice(0,10)) entry.text='长'.repeat(2000);
  await installSyntheticStateAndEnableShort(page,state);
  await page.reload();
  await expect(failureDialog(page)).toContainText('超出安全预算');
  await expect(failureDialog(page)).not.toContainText('计费');
  const blocked=await progress(page);
  expect(blocked).toMatchObject({failure:[{kind:'short',code:'MEMORY_BUDGET'}],pending:[false,false,false],eligible:45});
  expect(memory).toHaveLength(0);
  await page.reload();
  await expect(failureDialog(page)).toContainText('超出安全预算');
  expect(memory).toHaveLength(0);
  await closeFailure(page);
  const dialog=await summaryPage(page);
  await dialog.getByLabel('每次总结条数 · ' + summaryName,{exact:true}).fill('1');
  await clickSave(page);
  await expect.poll(async ()=>(await progress(page)).mid).toBe(1);
  await expect(dialog).not.toContainText('超出安全预算');
  expect(memory.map(item=>item.ids)).toEqual([[state.memories.short[0].id]]);
  expect((await progress(page)).sources).toEqual(state.memories.short[0].sourceTurnIds);
  log('BUDGET_RECOVERY',{before:0,after:memory.length,sourceCount:memory[0].ids.length});
});

test('另一个标签手动恢复后，原标签同步状态并继续不重叠的下一批', async ({page,context}) => {
  await page.clock.install();
  const a = await intercept(page,'http');
  await seedSummary(page,{count:45});
  await expect(failureDialog(page)).toBeVisible();
  await closeFailure(page);
  const settings = await summaryPage(page);
  const section = settings.getByRole('region',{name:summaryName,exact:true});
  await expect(section).toContainText('失败待处理');
  const { tab:b, traffic:other } = await openSecondTab(context);
  await expect(failureDialog(b)).toContainText('发送行动不会自动重试');
  await failureDialog(b).getByRole('button',{name:'重新生成',exact:true}).click();
  await expect.poll(async ()=>(await progress(b)).mid).toBe(1);
  await expect(section).toContainText('当前合格未覆盖：35 条');
  await expect(section).not.toContainText('失败待处理');
  expect(other.memory[0].ids).toEqual(a.memory[0].ids);
  expect(a.memory).toHaveLength(1);
  await b.close();
  await step(page);
  await expect.poll(async ()=>(await progress(page)).mid).toBe(2);
  expect(a.memory).toHaveLength(2);
  expect(a.memory[1].ids.some(id=>other.memory[0].ids.includes(id))).toBe(false);
  expect(new Set((await progress(page)).sources).size).toBe(20);
});

async function openSecondTab(context: import('@playwright/test').BrowserContext) {
  const tab = await context.newPage();
  await tab.clock.install();
  const traffic = await intercept(tab);
  await tab.goto('/');
  await tab.evaluate(async () => {
    const configPath = '/src/services/ai/configuration.ts', credPath = '/src/services/ai/credentials.ts';
    const { readAiConfig } = await import(configPath), { CredentialVault } = await import(credPath);
    new CredentialVault(sessionStorage, localStorage).set(readAiConfig(localStorage).channels[0].id, 'mock-summary-secret');
  });
  await openStoredSave(tab);
  await expect(tab.locator('.game-layout')).toBeVisible();
  return { tab, traffic };
}

async function installSyntheticStateAndEnableShort(page: Page, state: Awaited<ReturnType<typeof summaryState>>) {
  await page.evaluate(async state => {
    const sPath = '/src/domain/state.ts';
    const { GameStateSchema } = await import(sPath);
    const parsed = GameStateSchema.parse(state);
    await new Promise<void>((resolve,reject) => {
      const request = indexedDB.open('heijinwangchao');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('saves','readwrite');
        tx.objectStore('saves').put(parsed);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const key='heijin.settings.v1', saved=JSON.parse(localStorage.getItem(key)!);
    saved.memory.summaries.short.automatic=true;
    localStorage.setItem(key,JSON.stringify(saved));
  },state);
}

test('旧档投影可显示85条短期，但只有30条可自动整理', async ({page},info) => {
  await page.clock.install();
  const {memory} = await intercept(page);
  await seedSummary(page,{count:85,automatic:false});
  const state: GameState = await summaryState(page);
  state.memories.short = state.memories.short.slice(0,30);
  await installSyntheticStateAndEnableShort(page,state);
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
  const before=await progress(page);
  expect(before).toMatchObject({journal:85,archived:85,raw:30,eligible:30,mid:0});
  await step(page);
  await expect.poll(async()=>JSON.stringify((await progress(page)).cursor)).not.toBe(JSON.stringify(before.cursor));
  expect(memory).toHaveLength(0);
  await openWorldArchive(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  const archive=page.getByRole('dialog',{name:'记忆',exact:true});
  await expect(archive.getByRole('button',{name:'短期记忆',exact:true})).toContainText('85');
  await page.screenshot({path:info.outputPath('archive-85.png')});
  await archive.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  const settings=await summaryPage(page);
  const section = settings.getByRole('region',{name:summaryName,exact:true});
  await expect(section).toContainText('本层共 85 条 · 当前合格未覆盖：30 条');
  await expect(section).toContainText('等待达到阈值');
  await expect(section).toContainText('超过 30 条 · 每批 10 条');
  await expect(settings.getByLabel('自动总结 '+summaryName,{exact:true})).toBeChecked();
  await page.screenshot({path:info.outputPath('eligible-30.png')});
  log('ARCHIVE_VS_PENDING',{archived:before.archived,eligible:before.eligible,modelCalls:memory.length});
});

test('标签间共享关闭状态，同时进入时只发送一个批次', async ({page,context}) => {
  await page.clock.install();
  const a = await intercept(page);
  await seedSummary(page,{count:45});
  await expect.poll(async()=>(await progress(page)).mid).toBe(1);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      void navigator.locks.request('heijin.memory:save-a', () => new Promise<void>(release => {
        Reflect.set(window,'releaseReviewLock',release); resolve();
      }));
    });
  });
  const { tab:b, traffic:second } = await openSecondTab(context);
  const controlName='自动总结 '+summaryName;
  const settingsB = await summaryPage(b);
  await expect(settingsB.getByLabel(controlName,{exact:true})).toBeChecked();
  expect(second.memory).toHaveLength(0);
  const settingsA = await summaryPage(page);
  await settingsA.getByLabel(controlName,{exact:true}).uncheck();
  await clickSave(page);
  await expect(settingsB.getByLabel(controlName,{exact:true})).not.toBeChecked();
  await page.evaluate(() => Reflect.get(window,'releaseReviewLock')());
  const previous = await progress(b);
  await step(b);
  await expect.poll(async()=>JSON.stringify((await progress(b)).cursor)).not.toBe(JSON.stringify(previous.cursor));
  expect((await progress(b)).mid).toBe(1);
  expect(a.memory).toHaveLength(1);
  expect(second.memory).toHaveLength(0);
});
