import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { openGameTools } from './helpers/gameLayout';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { variableReply } from '../src/tests/fixtures/variableReply';
import type * as Fixture from '../src/tests/fixtures/worldviewBrowser';

const modulePath = '/src/tests/fixtures/worldviewBrowser.ts';
const faultsPath = '/src/tests/fixtures/worldviewFaults.ts';
type SnapshotRows = Awaited<ReturnType<typeof import('../src/tests/fixtures/worldviewFaults').snapshots>>;
async function snapshots(
  page: Page,
  op: 'read' | 'lose' | 'restore',
  records?: SnapshotRows,
): Promise<SnapshotRows> {
  return page.evaluate(async ({ faultsPath, op, records }) => (await import(faultsPath)).snapshots(op, records), {
    faultsPath,
    op,
    // Playwright traverses argument types recursively. IndexedDB keys are already structured-cloneable.
    records: records as unknown,
  });
}
const evidence = '经过十分钟，主角完成用餐。';
type Operation = Parameters<typeof Fixture.action>[0];
async function action(page: Page, op: Operation, backup?: string, id?: string) {
  return page.evaluate(
    async ({ modulePath, op, backup, id }) => (await import(modulePath)).action(op, backup, id),
    { modulePath, op, backup, id },
  );
}
interface MockControl {
  next?: 'partial' | 'fail';
  time?: string;
}
async function setup(page: Page, marker?: string, bodies: unknown[] = [], control: MockControl = {}) {
  const calls: { stage: string; origin: string; narrative: string }[] = [];
  await page.route('https://worldview-source.mock.invalid/**', async (route) => {
    const body = route.request().postDataJSON(),
      wire = JSON.stringify(body);
    bodies.push(body);
    const origin =
      ['device-A-world', 'device-B-world', '中国城市与地域差异'].find((m) => wire.includes(m)) ?? 'missing';
    const narrative =
      (origin === 'device-A-world'
        ? '张先生在月港散步。'
        : origin === 'device-B-world'
          ? '李先生在星城散步。'
          : '王先生在南城散步。') + evidence;
    calls.push({ stage: body.model, origin, narrative });
    const forced = control.next;
    delete control.next;
    if (forced === 'fail') return route.fulfill({ status: 503, json: { error: { message: 'test retry' } } });
    if (forced === 'partial')
      return route.fulfill({
        json: { choices: [{ message: { content: '<正文>张先生来到车站。' }, finish_reason: 'length' }] },
      });
    const content =
      body.model === 'story'
        ? '<thinking>本轮创作提纲：保持人物与场景连续。</thinking><正文>' +
          narrative +
          '</正文><短期记忆>用餐</短期记忆><变量规划>[]</变量规划>'
        : body.model === 'world'
          ? JSON.stringify({
              worldCommands: [],
              taskCommands: [],
              eventCommands: [],
              visibleHooks: [],
              unresolved: [],
            })
          : variableReply({
              commands: [
                {
                  type: 'SetWorldClock',
                  commandId: 'clock',
                  worldClock: control.time ?? '2026-10-18T08:10:00+08:00',
                  evidence,
                },
              ],
              rejectedSuggestions: [],
              unresolved: [],
            });
    if (body.tools?.some((tool: { function?: { name?: string } }) => tool.function?.name === 'actual_content')) {
      return route.fulfill({
        json: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'mock-story',
                    type: 'function',
                    function: { name: 'actual_content', arguments: JSON.stringify({ content }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      });
    }
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
  });
  await page.goto('/');
  if (marker)
    await page.evaluate(async ({ modulePath, marker }) => (await import(modulePath)).book(marker), {
      modulePath,
      marker,
    });
  return calls;
}

for (const scenario of ['overwrite', 'default'] as const) {
  test(
    scenario + ' 恢复外部正文后必须验证来源，再发送或结算',
    async ({ page, browser, isMobile, baseURL }, info) => {
      test.setTimeout(90000);
      const device = await browser.newContext({
        baseURL,
        viewport: page.viewportSize(),
        isMobile,
        hasTouch: isMobile,
      });
      try {
        const sourceWire: unknown[] = [],
          destinationWire: unknown[] = [];
        const archive = async () => {
          const path = info.outputPath('http-wire.json.gz');
          await writeFile(path, gzipSync(JSON.stringify({ sourceWire, destinationWire })));
          await info.attach('http-wire', { path, contentType: 'application/gzip' });
        };
        const source = await device.newPage(),
          sent = await setup(source, 'device-A-world', sourceWire);
        const local = await setup(page, scenario === 'overwrite' ? 'device-B-world' : undefined, destinationWire);
        await action(source, 'seed');
        const initial = await action(source, 'export');
        const a = await action(source, 'story');
        if (scenario === 'overwrite') {
          await action(page, 'import', initial);
          const b = await action(page, 'story');
          const identity = (d: typeof a) => [d.saveId, d.turnId, d.baseSaveRevision, d.storyRevision];
          expect(identity(b)).toEqual(identity(a));
          expect((await action(page, 'view')).state.createdAt).toBe(
            (await action(source, 'view')).state.createdAt,
          );
          expect(b.story.narrative).not.toBe(a.story.narrative);
        }
        // Use a complete but unsettled backup so even direct commit must verify provenance.
        await action(source, 'variables');
        await action(source, 'world');
        expect(sent.map((c) => c.origin)).toEqual(Array(3).fill('device-A-world'));
        const stale = scenario === 'overwrite' ? await snapshots(page, 'read') : [];
        const backup = await action(source, 'export');
        await action(page, 'import', backup);
        // Even an interrupted cleanup that left B's rows intact must fail closed.
        if (scenario === 'overwrite') {
          expect(stale.length).toBeGreaterThan(0);
          await snapshots(page, 'restore', stale);
        }
        await page.reload();
        for (const op of ['variables', 'world', 'commit'] as const) {
          const before = await action(page, 'view'),
            callCount = local.length;
          let error = '';
          try {
            await action(page, op);
          } catch (e) {
            error = String(e).split('\n')[0];
          }
          const after = await action(page, 'view');
          const observed = {
            project: info.project.name,
            scenario,
            op,
            wire: local.slice(callCount),
            error,
            story: before.draft.story.narrative,
            formalRevision: [before.state.revision, after.state.revision],
            draftRevision: [before.draft.draftRevision, after.draft.draftRevision],
          };
          console.log(JSON.stringify(observed));
          await info.attach(op, { body: JSON.stringify(observed), contentType: 'application/json' });
          expect.soft(error).toMatch(/worldbook.unbound|世界观|重新生成正文/);
          expect.soft(local.slice(callCount)).toEqual([]);
          expect.soft(after.state).toEqual(before.state);
          expect.soft(after.draft).toEqual(before.draft);
        }
        if (info.errors.length) {
          await archive();
          return;
        }
        const start = local.length;
        await action(page, 'configure');
        await page.goto('/#game/save-a');
        await page.reload();
        await openGameTools(page);
        await page.getByRole('button', { name: '完成本回合结算', exact: true }).last().click();
        const recovery = page.getByRole('button', { name: '按当前世界观重新生成正文' });
        await expect(recovery).toBeAttached();
        const diagnostics = page.getByRole('dialog', { name: '重试与变更详情' });
        if (await diagnostics.isVisible()) await page.keyboard.press('Escape');
        await recovery.click();
        await expect.poll(async () => (await action(page, 'view')).draft.storyRevision).toBe(a.storyRevision + 1);
        await page.reload();
        await action(page, 'variables');
        await action(page, 'world');
        await action(page, 'commit');
        expect(local.slice(start).map((c) => [c.stage, c.origin])).toEqual(
          ['story', 'variables', 'world'].map((stage) => [
            stage,
            scenario === 'overwrite' ? 'device-B-world' : '中国城市与地域差异',
          ]),
        );
        expect((await action(page, 'view')).state.revision).toBe(1);
        await archive();
      } finally {
        await device.close();
      }
    },
  );
}

test('截断、重试、删除原书及显式重新生成使用各自的世界观', async ({ page }) => {
  const control: MockControl = { next: 'partial' };
  const calls = await setup(page, 'device-A-world', [], control);
  await action(page, 'seed');
  await expect(action(page, 'story')).rejects.toThrow();
  const partial = await action(page, 'view');
  expect(partial.draft.storyPartial.text).toContain('来到车站');
  await page.evaluate(async (path) => (await import(path)).officialOnly(), faultsPath);
  const rows = await snapshots(page, 'read');
  await snapshots(page, 'lose');
  await page.reload();
  await expect(action(page, 'continue')).rejects.toThrow(/worldbook.unbound/);
  expect(calls.map((c) => c.stage)).toEqual(['story']);
  expect(await action(page, 'view')).toEqual(partial);
  await snapshots(page, 'restore', rows);
  control.next = 'fail';
  await expect(action(page, 'continue')).rejects.toThrow();
  await page.reload();
  await action(page, 'continue');
  await action(page, 'variables');
  await action(page, 'world');
  expect(calls.map((c) => c.origin)).toEqual(Array(5).fill('device-A-world'));
  await action(page, 'replace');
  await action(page, 'variables');
  await action(page, 'world');
  expect(calls.slice(-3).map((c) => c.origin)).toEqual(Array(3).fill('中国城市与地域差异'));
  expect((await action(page, 'commit')).state.revision).toBe(1);
});

test('官方正文快照损坏或缺失时阻止结算，删除重导也不会继承', async ({ page }) => {
  const calls = await setup(page);
  await action(page, 'seed');
  for (const op of ['story', 'variables', 'world'] as const) await action(page, op);
  const backup = await action(page, 'export'),
    before = await action(page, 'view');
  const rows = await snapshots(page, 'read');
  const damaged = structuredClone(rows);
  damaged[0].value.official['worldbooks.heijin.worldview'] = false;
  await snapshots(page, 'restore', damaged);
  await expect(action(page, 'variables')).rejects.toThrow(/worldbook.unbound/);
  await snapshots(page, 'lose');
  await expect(action(page, 'commit')).rejects.toThrow(/worldbook.unbound/);
  expect(await action(page, 'view')).toEqual(before);
  await action(page, 'delete');
  await action(page, 'import', backup);
  await snapshots(page, 'restore', rows);
  const restored = await action(page, 'view');
  expect(restored.instance).not.toEqual(before.instance);
  await expect(action(page, 'world')).rejects.toThrow(/worldbook.unbound/);
  await expect(action(page, 'commit')).rejects.toThrow(/worldbook.unbound/);
  expect(await action(page, 'view')).toEqual(restored);
  expect(calls.map((c) => c.stage)).toEqual(['story', 'variables', 'world']);
});

test('同名存档、历史回溯、撤回与失败后的行动重绑', async ({ page }) => {
  const control: MockControl = {};
  const calls = await setup(page, 'device-A-world', [], control);
  await action(page, 'seed');
  await action(page, 'seed', undefined, 'other-save');
  await action(page, 'story', undefined, 'other-save');
  const other = await action(page, 'view', undefined, 'other-save');
  for (const op of ['story', 'variables', 'world', 'commit'] as const) await action(page, op);
  const mark = await action(page, 'bookmark');
  await page.evaluate(async (path) => (await import(path)).officialOnly(), faultsPath);
  control.time = '2026-10-18T08:20:00+08:00';
  for (const op of ['story', 'variables', 'world', 'commit'] as const) await action(page, op);
  const undone = await action(page, 'undo');
  expect(undone.state.turnNumber).toBe(1);
  await action(page, 'bind', '去码头');
  control.next = 'fail';
  await expect(action(page, 'story')).rejects.toThrow();
  await page.evaluate(async (path) => (await import(path)).book('device-B-world'), modulePath);
  await action(page, 'bind', '改去车站');
  await action(page, 'story');
  expect(calls.at(-1)?.origin).toBe('device-B-world');
  const restored = await action(page, 'restore', mark);
  expect(restored.draft.story).toBeUndefined();
  expect(restored.state.turnNumber).toBe(1);
  await page.evaluate(async (path) => (await import(path)).officialOnly(), faultsPath);
  await action(page, 'story');
  expect(calls.at(-1)?.origin).toBe('中国城市与地域差异');
  expect((await action(page, 'view', undefined, 'other-save')).draft).toEqual(other.draft);
  await action(page, 'variables', undefined, 'other-save');
  expect(calls.at(-1)?.origin).toBe('device-A-world');
});

test('跨标签取消后覆盖导入，旧请求迟到也不能写入新实例', async ({ page, context }) => {
  const calls = await setup(page, 'device-A-world');
  await action(page, 'seed');
  await action(page, 'story');
  const backup = await action(page, 'export');
  const other = await context.newPage();
  await other.goto('/');
  let signalStart!: () => void, signalRelease!: () => void;
  const started = new Promise<void>((resolve) => {
      signalStart = resolve;
    }),
    release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
  await page.route('https://worldview-source.mock.invalid/**', async (route) => {
    signalStart();
    await release;
    await route.fulfill({ json: { choices: [{ message: { content: '旧请求迟到' } }] } }).catch(() => {});
  });
  const late = action(page, 'replace').then(() => '', String);
  try {
    await started;
    await expect(action(other, 'import', backup)).rejects.toThrow(/其他标签|正在执行/);
    expect(await page.evaluate(async (path) => (await import(path)).cancelStory(), modulePath)).toBe(true);
    expect(await late).toMatch(/取消/);
    await action(other, 'import', backup);
    const restored = await action(other, 'view');
    signalRelease();
    await expect(action(other, 'variables')).rejects.toThrow(/worldbook.unbound/);
    expect(await action(other, 'view')).toEqual(restored);
    expect(calls.map((c) => c.stage)).toEqual(['story']);
  } finally {
    signalRelease();
    await other.close();
  }
});

test('文学脚本正文保存后删除原书，刷新再补算两阶段', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'heijin.story-presets.v1',
      JSON.stringify({ enabled: true, selected: 'peinture-1118', packages: {} }),
    ),
  );
  const requests: unknown[] = [];
  const calls = await setup(page, 'device-A-world', requests);
  await action(page, 'seed');
  await action(page, 'story');
  expect(requests[0]).toMatchObject({
    tools: expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: 'actual_content' }) }),
    ]),
  });
  await page.evaluate(async (path) => (await import(path)).officialOnly(), faultsPath);
  await page.reload();
  await action(page, 'variables');
  await action(page, 'world');
  expect(calls.map((c) => [c.stage, c.origin])).toEqual(
    ['story', 'variables', 'world'].map((s) => [s, 'device-A-world']),
  );
  expect((await action(page, 'commit')).state.turnNumber).toBe(1);
});
