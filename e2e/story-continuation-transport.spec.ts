import { expect, type Page } from '@playwright/test';
import { test } from './helpers/continuation-https';
import { seedLegacyWriting } from './helpers/legacy-writing';
import preset from './fixtures/story-writing/v10-preset.json' with { type: 'json' };

async function readSave(page: Page) {
  return page.evaluate(async () => {
    const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
    const repository = await SaveRepository.open();
    try {
      const state = await repository.load('save-a');
      return { turn: state.turnNumber, revision: state.revision, draft: await repository.loadDraft('save-a'),
        narrative: state.journal.at(-1).story.narrative };
    } finally { repository.close(); }
  });
}

async function changePace(page: Page) {
  await page.evaluate(async () => {
    const [host, library, editor] = await Promise.all(['/src/presets/tavern/hostState.ts',
      '/src/presets/library.ts', '/src/presets/peintureSettings.ts'].map(path => import(path)));
    const selection = library.captureAssistantSelection(), preset = await library.resolveStoryPreset(selection);
    const old = host.readEditorOverride(preset.definition.id);
    host.storeEditorOverride(preset.definition.id, old, editor.toggleEntry(preset, old ?? editor.emptyOverride(preset), 'wave-pace-fast', true));
  });
}

const cases = [
  { title: '直连成功', choice: 'direct', mode: 'success' },
  { title: '预检期间另一标签改变节奏', choice: 'direct', mode: 'deny-preflight' },
  { title: '直连受理后响应不允许跨域读取', choice: 'direct', mode: 'opaque' },
  { title: '直连受理后断开连接', choice: 'direct', mode: 'reset' },
  { title: '玩家选择中转', choice: 'relay', mode: 'success' },
  { title: '中转上游已接收后连接中断', choice: 'relay', mode: 'reset' },
  { title: '关闭中转时直连失败', choice: 'direct', mode: 'opaque', off: true },
  { title: '网络异常后重新确认选择中转', choice: 'direct', mode: 'opaque', retry: true },
] as const;

for (const scenario of cases) {
  test(scenario.title, async ({ page, context, network }, info) => {
    await seedLegacyWriting(page, preset.draft, 'preset');
    const relayOff = 'off' in scenario;
    await page.evaluate(off => {
      if (off) localStorage.setItem('heijin.ai.corsRelay', 'off');
      // The fixture uses the normal settings storage. Also exercise enabled stage retries.
      return import('/src/ui/settings/model.ts' as string).then(({ settingsKey }) => {
        const settings = JSON.parse(localStorage.getItem(settingsKey)!);
        settings.runtime.failureAutoRetry = true;
        localStorage.setItem(settingsKey, JSON.stringify(settings));
      });
    }, relayOff);
    await page.goto('/#game/save-a'); await page.reload();
    const partial = page.locator('.story-partial');
    await expect(partial).toContainText('路牌亮起灯光');
    const direct = page.getByRole('button', { name: '续写正文', exact: true });
    const relay = partial.getByRole('button', { name: '通过本站中转续写' });
    if (relayOff) await expect(relay).toHaveCount(0);
    const before = await readSave(page);
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    network.mode = scenario.mode;
    if (scenario.choice === 'relay') await network.serveRelay();
    await Promise.all([page.waitForEvent('dialog'), (scenario.choice === 'direct' ? direct : relay).click()]);
    if (scenario.mode === 'deny-preflight') {
      await network.preflight.promise;
      expect(network.modelPosts).toHaveLength(0);
      const editor = await context.newPage(); await editor.goto('/');
      await changePace(editor); await editor.close();
      network.resume.resolve();
    }
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain(scenario.choice === 'direct' ? '直连模型服务' : '通过本站中转');
    const success = scenario.mode === 'success';
    if (success) await expect.poll(async () => (await readSave(page)).turn).toBe(before.turn + 1);
    else await expect(partial).toContainText('模型服务可能已受理请求并计费');
    const after = await readSave(page);
    if (success) {
      expect(after.revision).toBe(before.revision + 1);
      expect(after.narrative).toContain('电车抵达站台');
    } else expect(after).toEqual(before);
    const first = { direct: network.direct, worker: network.worker, model: network.modelPosts.length };
    await info.attach('first-send', { contentType: 'application/json', body: JSON.stringify({
      ...first, workerUpstream: network.callbacks, modelReceipts: network.modelPosts, options: network.options,
      turn: [before.turn, after.turn], revision: [before.revision, after.revision], confirmations: dialogs.length,
      preservedDraft: JSON.stringify(after.draft) === JSON.stringify(before.draft),
    }) });
    expect(first).toEqual({ direct: Number(scenario.choice === 'direct'), worker: Number(scenario.choice === 'relay'),
      model: Number(scenario.mode !== 'deny-preflight') });
    expect(network.callbacks).toBe(network.worker);
    if ('retry' in scenario) {
      if (info.project.name === 'mobile') {
        const details = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '重试与变更详情' }) });
        await details.getByRole('button', { name: '关闭资料界面' }).click();
        await expect(details).toBeHidden();
      }
      network.mode = 'success';
      const editor = await context.newPage(); await editor.goto('/'); await changePace(editor); await editor.close();
      await network.serveRelay();
      await relay.click();
      await expect.poll(async () => (await readSave(page)).turn).toBe(before.turn + 1);
      expect(dialogs).toHaveLength(2);
      expect(dialogs[1]).toContain('通过本站中转');
      expect([network.direct, network.worker, network.callbacks, network.modelPosts.length]).toEqual([1, 1, 1, 2]);
    }
    expect(await page.evaluate(() => localStorage.getItem('heijin.ai.corsRelay'))).toBe(relayOff ? 'off' : null);
    const final = await readSave(page);
    await info.attach('transmission', { contentType: 'application/json', body: JSON.stringify({
      first, browserDirect: network.direct, browserWorker: network.worker, workerUpstream: network.callbacks,
      modelReceipts: network.modelPosts, options: network.options, confirmations: dialogs.length,
      turn: [before.turn, final.turn], revision: [before.revision, final.revision],
      initialFailurePreservedDraft: success ? null : JSON.stringify(after.draft) === JSON.stringify(before.draft),
    }) });
  });
}
