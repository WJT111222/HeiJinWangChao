import { expect } from './test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const root = 'test-results/action-recovery-evidence';
const oldOptions = ['沿江走一走', '去书店看看', '留下观察街道'];
async function setup(page: Page, options = true, timeoutSeconds = 30) {
    // The app captures its base fetch at startup. Install before app scripts in
    // every document, including reloads and the second tab in the recovery test.
    await page.context().route('https://actions-recovery.mock.invalid/**', route => route.abort('blockedbyclient'));
    await installTransport(page);
    await page.goto('/');
    await page.evaluate(async ({ options, oldOptions, timeoutSeconds }) => {
        const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
        const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map(p => import(p)));
        const settings = defaultSettings();
        settings.prompts.minNarrativeChars = 5;
        settings.prompts.actionOptions = true;
        settings.runtime.timeoutSeconds = timeoutSeconds;
        for (const c of Object.values(settings.memory.summaries) as {
            automatic: boolean;
        }[])
            c.automatic = false;
        localStorage.setItem(settingsKey, JSON.stringify(settings));
        const channel = newChannel(), config = defaultAiConfig();
        channel.baseUrl = 'https://actions-recovery.mock.invalid/v1';
        config.channels = [channel];
        config.routes.story = { channelId: channel.id, modelId: 'story' };
        for (const stage of ['entities','variables','world'])
            config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
        saveAiConfig(localStorage, config);
        new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-not-a-key');
        const r = await SaveRepository.open();
        try {
            const s = worldState();
            s.openingCityId = 'chongqing';
            await r.create(s);
            const d = await completeDraft(r, options ? { actionOptions: oldOptions } : {});
            await r.commitTurn({ draft: d, nextAction: '', useVariableStage: true, useWorldStage: true });
            const other = worldState();
            other.saveId = 'save-b';
            await r.create(other);
        }
        finally {
            r.close();
        }
    }, { options, oldOptions, timeoutSeconds });
    await page.goto('/#game/save-a');
    await page.reload();
    await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function installTransport(page: Page) {
    await page.context().addInitScript(() => {
        const native = window.fetch.bind(window), encoder = new TextEncoder();
        const control = { mode: 'ok', stage: 'story', calls: [] as {
                stage: string;
                action: string;
            }[], breakStream: undefined as undefined | (() => void), release: undefined as undefined | (() => void) };
        (window as typeof window & {
            actionMock: typeof control;
        }).actionMock = control;
        window.fetch = async (input, init) => {
            if (!String(input).startsWith('https://actions-recovery.mock.invalid/'))
                return native(input, init);
            const req = JSON.parse(String(init?.body));
            const combined = req.messages.map((m: {
                content: string;
            }) => m.content).join('\n'), ctx = JSON.parse(combined.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]);
            const stage = req.model, mode = stage === control.stage ? control.mode : 'ok';
            control.calls.push({ stage, action: ctx.PLAYER_ACTION ?? ctx.PLAYER_INPUT ?? '' });
            const text = (body: string) => `<thinking>按本轮行动继续</thinking><正文>${body}</正文><短期记忆>观察街道。</短期记忆><变量规划>[]</变量规划><行动选项>去公园等候\n去码头问路\n去社区走走</行动选项>`;
            const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
            if (['401', '429', '500'].includes(mode))
                return new Response('synthetic-http-failure', { status: Number(mode) });
            if (mode === 'hold' || mode === 'timeout') {
                await new Promise<void>(resolve => { control.release = resolve; });
            }
            if (mode === 'partial' || mode === 'silence')
                return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(frame('<thinking>计划</thinking><正文>主角在街边等候，'))); control.breakStream = () => controller.error(new TypeError('synthetic-disconnection')); } }), { headers: { 'content-type': 'text/event-stream' } });
            if (stage === 'story') {
                const content = mode === 'incomplete' ? '<thinking>计划</thinking><正文>这份正文还没有结束' : text(mode === 'invalid' ? '短' : '主角在街边观察，经过一分钟后继续等候。');
                return new Response(frame(content) + (mode === 'missing-done' ? '' : 'data: [DONE]\n\n'), { headers: { 'content-type': 'text/event-stream' } });
            }
            let content: string;
            if (stage === 'entities') {
                content = '<接触者>[]</接触者><thinking>本轮没有人物变化</thinking><说明></说明><命令></命令>';
            } else if (stage === 'variables') {
                const p = '/src/tests/fixtures/variableReply.ts', { variableReply } = await import(p);
                content = variableReply({ commands: [{ type: 'SetWorldClock', commandId: 'clock', worldClock: new Date(Date.parse(ctx.SAVE_STATE.worldClock) + 60000).toISOString(), evidence: '经过一分钟' }], rejectedSuggestions: [], unresolved: [] });
            }
            else
                content = JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
            return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        };
    });
}
async function plan(page: Page, mode: string, stage = 'story') { await page.evaluate(({ mode, stage }) => { const c = Reflect.get(window, 'actionMock'); c.mode = mode; c.stage = stage; }, { mode, stage }); }
async function calls(page: Page) { return page.evaluate(() => Reflect.get(window, 'actionMock').calls as {
    stage: string;
    action: string;
}[]); }
async function data(page: Page) { return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), r = await SaveRepository.open(); try {
    return await r.loadGame('save-a');
}
finally {
    r.close();
} }); }
async function closeError(page: Page) { const d = page.locator('dialog.mobile-diagnostics-sheet[open]'); if (await d.isVisible())
    await page.keyboard.press('Escape'); }
async function send(page: Page, action = '沿江走一走') { await closeError(page); await page.locator('#player-input').fill(action); await page.getByRole('button', { name: '发送', exact: true }).click(); }
const button = (page: Page) => page.locator('.composer-workflow-action');
async function stopped(page: Page) { await expect(button(page)).toHaveAttribute('data-kind', 'continue'); await expect(page.locator('[aria-label="流式正文预览"]')).toHaveCount(0); }
async function snapshot(page: Page) { const d = await data(page); return { state: { revision: d.state.revision, turnNumber: d.state.turnNumber, journalCount: d.state.journal.length, oldOptions: d.state.journal.at(-1)?.story.actionOptions }, draft: d.draft && { turnId: d.draft.turnId, story: !!d.draft.story, variables: !!d.draft.variables, world: !!d.draft.world, stageStatus: d.draft.stageStatus, failures: d.draft.failures, executionRevision: d.draft.executionRevision, userInput: d.draft.userInput }, ui: { action: await button(page).getAttribute('aria-label') || await button(page).innerText(), kind: await button(page).getAttribute('data-kind'), sendDisabled: await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), input: await page.locator('#player-input').inputValue(), suggestions: await page.locator('.action-options button').allTextContents(), placeholder: await page.getByText('行动建议将在正文生成后显示。', { exact: true }).count(), workflow: await page.locator('.workflow-summary').innerText() }, calls: await calls(page) }; }
async function record(page: Page, name: string, project: string) { await mkdir(`${root}/before-screenshots`, { recursive: true }); await mkdir(`${root}/logs`, { recursive: true }); await writeFile(`${root}/logs/${project}-${name}.json`, JSON.stringify(await snapshot(page), null, 2)); await page.screenshot({ path: `${root}/before-screenshots/${project}-${name}.png` }); }
export { setup, plan, calls, data, closeError, send, button, stopped, record, snapshot, oldOptions };
