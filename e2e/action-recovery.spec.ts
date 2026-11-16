import { test, expect } from './helpers/test';
import { openWorkflowDiagnostics, openSettings } from './helpers/gameLayout';
import { setup, transport, plan, calls, data, closeError, send, button, stopped, record, snapshot, oldOptions } from './helpers/actionRecovery';
for (const mode of ['500', '401', '429', 'invalid', 'incomplete', 'missing-done', 'partial', 'silence', 'timeout', 'hold'])
    test(`A ${mode}: inspect stopped state and explicit resend`, async ({ page }, info) => {
        await setup(page, true, ['silence', 'timeout'].includes(mode) ? 5 : 30);
        const original = await data(page);
        await expect(page.getByRole('button', { name: /沿江走一走/ })).toBeVisible();
        await plan(page, mode);
        await send(page);
        await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(0);
        if (['partial', 'silence'].includes(mode)) {
            await expect(page.getByRole('article', { name: '流式正文预览' })).toBeVisible();
            await expect(page.locator('.action-options')).toHaveCount(0);
            await record(page, `${mode}-running`, info.project.name);
            if (mode === 'partial')
                await page.evaluate(() => Reflect.get(window, 'actionMock').breakStream());
        }
        if (mode === 'hold') {
            await expect(button(page)).toHaveAttribute('data-kind', 'cancel');
            await button(page).click();
        }
        if (mode !== 'hold')
            await expect.poll(async () => (await data(page)).draft?.stageStatus.story, { timeout: 15000 }).toBe('failed');
        await stopped(page);
        await closeError(page);
        await record(page, mode, info.project.name);
        const failed = await data(page);
        expect(failed.state).toEqual(original.state);
        expect(failed.state.journal.at(-1)?.story.actionOptions).toEqual(oldOptions);
        expect(failed.draft?.story).toBeUndefined();
        await expect(page.getByText('上一已结算回合建议 · 第1回合', { exact: false })).toBeVisible();
        await expect(page.getByRole('button', { name: /去书店看看/ })).toBeEnabled();
        await expect(page.locator('#action-recovery-guidance')).toContainText('尚无正文候选');
        const beforeView = await data(page);
        const beforeCalls = await calls(page);
        await page.getByRole('button', { name: /去书店看看/ }).click();
        // 行动建议叠加到输入框：失败后回填的原行动保留，建议用中文逗号接在后面。
        await expect(page.locator('#player-input')).toHaveValue('沿江走一走，去书店看看');
        expect(await data(page)).toEqual(beforeView);
        expect(await calls(page)).toEqual(beforeCalls);
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
        expect((await calls(page)).length).toBe(mode === '500' ? 2 : 1);
        await plan(page, 'ok');
        await send(page, '改去书店看看');
        await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
        await expect(button(page)).toHaveAttribute('data-kind', 'idle');
        expect((await calls(page)).map(c => c.stage)).toEqual([...(mode === '500' ? ['story', 'story'] : ['story']), 'story', 'variables', 'world']);
    });
for (const stage of ['variables', 'world'])
    test(`B ${stage}: disabled send versus legal stage continuation`, async ({ page }, info) => {
        await setup(page);
        const original = await data(page);
        await plan(page, '401', stage);
        await send(page);
        await expect.poll(async () => (await data(page)).draft?.stageStatus[stage]).toBe('failed');
        await stopped(page);
        await closeError(page);
        await page.locator('#player-input').fill('下一轮想去书店');
        const failed = await data(page);
        expect(failed.state).toEqual(original.state);
        expect(failed.draft?.stageStatus[stage]).toBe('failed');
        expect(failed.draft?.story).toBeTruthy();
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
        await expect(page.getByText('当前正文建议（本回合尚未结算）', { exact: false })).toBeVisible();
        await expect(page.locator('#action-recovery-guidance')).toContainText(stage === 'variables' ? '继续生成变量' : '继续生成世界');
        await record(page, stage, info.project.name);
        await page.reload();
        await expect(page.getByTestId('story-reader')).toBeVisible();
        expect(await data(page)).toEqual(failed);
        await transport(page);
        await button(page).click();
        await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
        expect((await calls(page)).map(c => c.stage)).toEqual(stage === 'variables' ? ['variables', 'world'] : ['world']);
    });
test('B commit: real atomic failure, saving lock, retry without new models', async ({ page }, info) => {
    await setup(page);
    const original = await data(page);
    await page.evaluate(async () => {
        const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), commit = SaveRepository.prototype.commitTurn;
        Reflect.set(window, 'holdCommit', true);
        Reflect.set(window, 'failWrites', true);
        SaveRepository.prototype.commitTurn = async function (...args: Parameters<typeof commit>) { if (Reflect.get(window, 'holdCommit')) {
            Reflect.set(window, 'commitEntered', true);
            await new Promise<void>(r => Reflect.set(window, 'releaseCommit', r));
        } return commit.apply(this, args); };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'saves' && Reflect.get(window, 'failWrites'))
            throw new DOMException('synthetic-quota', 'QuotaExceededError'); return put.apply(this, args); };
    });
    await send(page);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'commitEntered'))).toBe(true);
    await expect(button(page)).toBeDisabled();
    await expect(button(page)).toContainText(info.project.name === 'mobile' ? '停' : '正在保存');
    expect((await data(page)).state).toEqual(original.state);
    await page.evaluate(() => Reflect.get(window, 'releaseCommit')());
    await stopped(page);
    await closeError(page);
    await record(page, 'commit', info.project.name);
    const ready = await data(page);
    expect(ready.state).toEqual(original.state);
    expect(ready.draft?.stageStatus).toEqual({ story: 'ready', variables: 'ready', world: 'ready' });
    const posted = await calls(page);
    await page.evaluate(() => { Reflect.set(window, 'holdCommit', false); Reflect.set(window, 'failWrites', false); });
    await button(page).click();
    await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
    expect(await calls(page)).toEqual(posted);
});
test('D lifecycle: no Web Locks, tabs, settings, cancelled late response and reload', async ({ page, context }, info) => {
    await setup(page, true, 30);
    const original = await data(page);
    await plan(page, 'hold');
    await send(page);
    await expect(button(page)).toHaveAttribute('data-kind', 'cancel');
    const second = await context.newPage();
    await second.goto('/#game/save-a');
    await expect(second.getByTestId('story-reader')).toBeVisible();
    await transport(second);
    await send(second, '另一标签的新行动');
    await expect.poll(async () => (await snapshot(second)).ui.kind).toBe('continue');
    expect(await calls(second)).toHaveLength(0);
    expect((await data(second)).draft?.userInput).toBe('沿江走一走');
    await second.close();
    await button(page).click();
    await stopped(page);
    await plan(page, 'invalid');
    await send(page, '改去书店');
    await expect.poll(async () => (await data(page)).draft?.stageStatus.story).toBe('failed');
    await stopped(page);
    await closeError(page);
    const failed = await data(page);
    await page.evaluate(() => Reflect.get(window, 'actionMock').release?.());
    expect(await data(page)).toEqual(failed);
    await openWorkflowDiagnostics(page);
    await page.keyboard.press('Escape');
    await openSettings(page);
    await page.keyboard.press('Escape');
    expect(await data(page)).toEqual(failed);
    await page.reload();
    await expect(page.getByTestId('story-reader')).toBeVisible();
    await transport(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
    await send(page, '读档后重新输入');
    await closeError(page);
    await record(page, 'no-locks', info.project.name);
    expect(await calls(page)).toHaveLength(0);
    expect(await data(page)).toEqual(failed);
    expect((await data(page)).state).toEqual(original.state);
});
test('C explicit suggestion, twice failed, unsent edit, save switch, reload and resend', async ({ page }, info) => {
    await setup(page);
    const original = await data(page);
    await page.getByRole('button', { name: /沿江走一走/ }).click();
    await expect(page.locator('#player-input')).toHaveValue(oldOptions[0]);
    expect(await data(page)).toEqual(original);
    expect(await calls(page)).toHaveLength(0);
    await plan(page, 'invalid');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await data(page)).draft?.failures.length).toBe(1);
    await stopped(page);
    await closeError(page);
    await button(page).click();
    await expect.poll(async () => (await data(page)).draft?.failures.length).toBe(2);
    await stopped(page);
    await closeError(page);
    const failed = await data(page);
    expect(failed.state).toEqual(original.state);
    expect(await calls(page)).toHaveLength(2);
    await page.locator('#player-input').fill('暂未发送的修改');
    await record(page, 'twice-failed-unsent', info.project.name);
    expect(await data(page)).toEqual(failed);
    await page.goto('/#game/save-b');
    await expect(page.getByTestId('story-reader')).toBeVisible();
    // save-b intentionally has formal state only: it must not inherit save-a's draft failure.
    await expect(page.locator('.workflow-summary')).toContainText('草稿不可用');
    await expect(page.locator('.saved-failure-summary')).toHaveCount(0);
    expect(await calls(page)).toHaveLength(2);
    await page.goto('/#game/save-a');
    await expect(page.getByTestId('story-reader')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('story-reader')).toBeVisible();
    await expect(page.locator('#player-input')).toHaveValue(oldOptions[0]);
    expect(await data(page)).toEqual(failed);
    await transport(page);
    await plan(page, 'ok');
    await page.locator('#player-input').fill('改去街边观察');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
    expect((await calls(page)).map(c => c.stage)).toEqual(['story', 'variables', 'world']);
});
test('reference-only old options, shortcuts and no fabricated options preserve bound action', async ({ page }) => {
    await setup(page);
    await plan(page, '401', 'variables');
    await send(page);
    await expect.poll(async () => (await data(page)).draft?.stageStatus.variables).toBe('failed');
    await closeError(page);
    // Simulate a legitimate Story without actionOptions: the historical suggestions are references,
    // not an authorization to replace the already bound Story/Variables action.
    await page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', dp = '/src/domain/drafts.ts', { SaveRepository } = await import(p), { rerollStory } = await import(dp), r = await SaveRepository.open(); try {
        const d = await r.loadDraft('save-a');
        await r.saveDraft(rerollStory(d, { ...d.story, actionOptions: undefined }), d.draftRevision);
    }
    finally {
        r.close();
    } });
    await page.reload();
    await expect(page.getByTestId('story-reader')).toBeVisible();
    await transport(page);
    const original = await data(page);
    await expect(page.getByText('上一已结算回合建议 · 第1回合', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /沿江走一走/ })).toBeDisabled();
    await expect(page.getByText('仅供参考；请先完成当前回合，不能替换已绑定行动。', { exact: true })).toBeVisible();
    await page.getByTestId('story-reader').focus();
    await page.keyboard.press('1');
    await expect(page.locator('#player-input')).toHaveValue('');
    expect(await data(page)).toEqual(original);
    expect(await calls(page)).toHaveLength(0);
    await button(page).click();
    await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
    expect((await calls(page)).map(c => c.stage)).toEqual(['variables', 'world']);
    // This newly committed Story had no suggestions. Do not search older journal entries or invent any.
    await expect(page.locator('.action-options')).toHaveCount(0);
});
test('responsive recovery guidance stays clear of input, bottom navigation and workflow drawer', async ({ page }, info) => {
    await setup(page);
    await plan(page, '401', 'world');
    await send(page);
    await expect.poll(async () => (await data(page)).draft?.stageStatus.world).toBe('failed');
    await closeError(page);
    const original = await data(page), posted = await calls(page);
    const sizes = info.project.name === 'mobile' ? [{ width: 390, height: 844 }, { width: 392, height: 640 }, { width: 392, height: 420 }] : [{ width: 1440, height: 900 }, { width: 901, height: 768 }];
    for (const size of sizes) {
        await page.setViewportSize(size);
        await expect(page.locator('#action-recovery-guidance')).toContainText('继续生成世界');
        const input = page.locator('#player-input'), sendButton = page.getByRole('button', { name: '发送', exact: true });
        await input.click();
        await input.fill('保留在本页的下一轮打算');
        await expect(sendButton).toBeDisabled();
        const bounds = await page.evaluate(() => { const input = document.querySelector('#player-input')!.getBoundingClientRect(), hint = document.querySelector('#action-recovery-guidance')!.getBoundingClientRect(), nav = document.querySelector('.mobile-game-nav')!.getBoundingClientRect(); return { inputBottom: input.bottom, hintTop: hint.top, hintBottom: hint.bottom, navTop: nav.top, overflow: document.documentElement.scrollWidth > innerWidth }; });
        expect(bounds.overflow).toBe(false);
        expect(bounds.hintTop).toBeGreaterThanOrEqual(bounds.inputBottom);
        if (info.project.name === 'mobile')
            expect(bounds.hintBottom).toBeLessThanOrEqual(bounds.navTop + 1);
        await page.screenshot({ path: `test-results/action-recovery-evidence/${info.project.name}-${size.width}x${size.height}.png` });
    }
    // Dismissing the simulated keyboard restores the real viewport before reading diagnostics.
    // Keep every short-viewport input/navigation geometry assertion above.
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    await openWorkflowDiagnostics(page);
    await page.keyboard.press('Escape');
    expect(await data(page)).toEqual(original);
    expect(await calls(page)).toEqual(posted);
    await plan(page, 'ok');
    await button(page).click();
    await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
    expect((await calls(page)).map(c => c.stage)).toEqual(['story', 'variables', 'world', 'world']);
});
