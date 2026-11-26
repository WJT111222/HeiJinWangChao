import { expect, test } from './helpers/test';
import type { Locator, Page } from '@playwright/test';
import { openGameTools, openSettings, openStageRaw } from './helpers/gameLayout';
import { settingsTextContrast } from './helpers/settingsContrast';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import controls from '../src/presets/resources/peinture-controls.json' with { type: 'json' };
import fixture from './fixtures/peinture-game.json' with { type: 'json' };

type Protocol = 'openai' | 'deepseek' | 'anthropic' | 'gemini';
const pack = 'peinture-1118';
const envelope =
  '<正文>船靠岸了，林舟沿着石阶往上走。</正文><短期记忆>林舟上岸</短期记忆><变量规划>[]</变量规划>';
const toolName = 'actual_content';
const playerAction = '我立即拿起手机，联系仓库负责人，询问货物现在的具体位置。';
const warehouseStory = '林舟拨通仓库负责人的电话，核对发货单上的“货号 A”，确认货物的具体位置。'.repeat(320) + '最后一行。';
const warehouseEnvelope = '<正文>' + warehouseStory + '</正文><短期记忆>林舟致电仓库</短期记忆><变量规划>[]</变量规划>';

const museumAction = '我去市博物馆，向馆员核对展品编号。';
const museumStory = '林舟来到市博物馆，向馆员逐项核对展品编号。'.repeat(1200) + '编号一致。';
const museumEnvelope = '<正文>' + museumStory + '</正文><短期记忆>林舟核对展品</短期记忆><变量规划>[]</变量规划>';

function readReference(description: string) {
  const records = JSON.parse(description.slice(description.lastIndexOf('\n') + 1)) as { role: string; content: string }[];
  return records.map(m => JSON.parse(m.content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)));
}

function upstream(protocol: Protocol, stream: boolean, content = envelope) {
  const args = { content };
  const longDelivery = content === warehouseEnvelope || content === museumEnvelope;
  const serialized = JSON.stringify(args);
  const fragments = longDelivery
    ? serialized.match(/[\s\S]{1,127}/gu)!
    : [serialized.slice(0, 6), serialized.slice(6)];
  const padding = ' \n\t';
  const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
  let full: unknown;
  let sse: string;
  if (protocol === 'gemini') {
    full = {
      candidates: [
        { content: { parts: [{ functionCall: { name: toolName, args } }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { candidatesTokenCount: 12 },
    };
    const prefix = { candidates: [{ content: { parts: [{ text: padding }] } }] };
    sse = (longDelivery ? event(prefix) : '') + event(full);
  } else if (protocol === 'anthropic') {
    const index = longDelivery ? 1 : 0;
    const block = { type: 'tool_use', id: 'fixture-call', name: toolName, input: args };
    full = { content: [block], stop_reason: 'tool_use', usage: { output_tokens: 12 } };
    sse = [
      ...(longDelivery ? [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: padding } },
        { type: 'content_block_stop', index: 0 },
      ] : []),
      { type: 'content_block_start', index, content_block: { ...block, input: {} } },
      ...fragments.map(partial_json => ({
        type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json },
      })),
      { type: 'content_block_stop', index },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ]
      .map(event)
      .join('');
  } else {
    const call = {
      type: 'function',
      id: 'fixture-call',
      function: { name: toolName, arguments: serialized },
    };
    full = {
      choices: [{ message: { tool_calls: [call] }, finish_reason: 'tool_calls' }],
      usage: { completion_tokens: 12 },
    };
    const toolFrames = fragments.map((part, i) => {
      const chunk = i === 0
        ? { ...call, index: 0, function: { ...call.function, arguments: part } }
        : { index: 0, function: { arguments: part } };
      return event({ choices: [{ delta: { tool_calls: [chunk] } }] });
    });
    sse =
      (longDelivery ? event({ choices: [{ delta: { content: padding } }] }) : '') +
      toolFrames.join('') +
      event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { completion_tokens: 12 } }) +
      'data: [DONE]\n\n';
  }
  return stream ? { contentType: 'text/event-stream', body: sse } : { json: full };
}

// Synthetic save and opening draft produced with game() and createTurnDraft(); no production test hooks.
async function prepare(page: Page, protocol: Protocol, stream: boolean, active: boolean, actionOptions = false, action?: string, regular = false, tideMaterials = false) {
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'peinture.mock.invalid') {
      sent.push(route.request().postData() ?? '');
      if (
        protocol === 'openai' &&
        !stream &&
        !route
          .request()
          .postDataJSON()
          .tools?.some((t: { function: { name: string } }) => t.function.name === toolName)
      )
        return route.fulfill({
          json: {
            choices: [
              {
                message: { content: sent.at(-1)!.includes('<wave_delivery>') ? '<wave_delivery>' + envelope + '</wave_delivery>' : envelope },
                finish_reason: 'stop',
              },
            ],
          },
        });
      if (action !== undefined && !tideMaterials) {
        if (regular && sent.length === 1) return route.fulfill({json: {error: {type: 'synthetic_failure'}}});
        const body = route.request().postDataJSON();
        const tools = protocol === 'gemini' ? body.tools[0].functionDeclarations
          : protocol === 'anthropic' ? body.tools : body.tools.map((t: {function: unknown}) => t.function);
        const description = tools.find((t: {name: string}) => t.name === 'wave_context_reference')?.description;
        const current = description && readReference(description).at(-1);
        // The Mock selects its reply from the received current record, even when history describes the other action.
        const replies = new Map([[playerAction, warehouseEnvelope], [museumAction, museumEnvelope]]);
        return route.fulfill(upstream(protocol, stream, replies.get(current?.PLAYER_ACTION) ?? envelope));
      }
      return route.fulfill(upstream(protocol, stream));
    }
    return ['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'blob:'
      ? route.continue()
      : route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().waitFor();
  await page.evaluate(
    async ({ fixture, protocol, stream, active, pack, actionOptions, action, regular, historicalAction, tideMaterials }) => {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => ok(request.result);
        request.onerror = () => fail(request.error);
      });
      try {
        const tx = db.transaction(['saves', 'drafts'], 'readwrite');
        for (const { name, records } of fixture.rows)
          for (const value of records) {
            if ('userInput' in value && action !== undefined) value.userInput = action;
            const seeded = !regular ? value : 'userInput' in value
              ? { ...value, turnKind: 'regular', turnId: 'museum-turn', baseSaveRevision: 1 }
              : { ...value, revision: 1, turnNumber: 1, journal: [{ turnId: 'previous-turn', revision: 1,
                story: { turnKind: 'opening', narrative: historicalAction, summary: '此前询问仓库', variableGuide: [] },
                relatedActorRefs: [] }] };
            if (tideMaterials && 'protagonist' in seeded) {
              Object.assign(seeded.npc, { 'c1-witness': { id: 'c1-witness', identityKey: 'identity-witness', kind: 'ordinary', name: '沈潮汐',
                aliases: [], skills: [], onScene: true, affinity: 10, relationshipText: '码头同事', locationId: 'chongqing', memories: [], knownInformation: [] } });
              Object.assign(seeded.memories, { long: [{ id: 'tide-memory', text: '铜铃封存在第三座灯塔', sourceTurnIds: ['previous-turn'],
                affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: seeded.worldClock }] });
            }
            tx.objectStore(name).put(seeded);
            const other = structuredClone(seeded);
            other.saveId = 'peinture-second';
            if ('protagonist' in other) {
              other.protagonist.name = '顾乙';
              if (tideMaterials) other.worldClock = '2031-03-09T08:00:00+08:00';
            }
            tx.objectStore(name).put(other);
          }
        await new Promise<void>((ok, fail) => {
          tx.oncomplete = () => ok();
          tx.onabort = () => fail(tx.error);
        });
      } finally {
        db.close();
      }
      fixture.config.channels[0].protocol = protocol;
      fixture.settings.runtime.streamStory = stream;
      fixture.settings.prompts.actionOptions = actionOptions;
      localStorage.setItem('heijin.ai.v1', JSON.stringify(fixture.config));
      localStorage.setItem(fixture.settingsKey, JSON.stringify(fixture.settings));
      sessionStorage.setItem('heijin.credential.v1:fixture-channel', 'fixture-only');
      if (active)
        localStorage.setItem(
          'heijin.story-presets.v1',
          JSON.stringify({ enabled: true, selected: pack, packages: {} }),
        );
    },
    { fixture, protocol, stream, active, pack, actionOptions, action, regular, historicalAction: playerAction, tideMaterials },
  );
  await page.reload();
  return sent;
}
async function generate(page: Page, id = 'peinture-smoke', expected = '船靠岸了，林舟沿着石阶往上走。', button = '生成开局正文') {
  await page.goto('/#game/' + id);
  await openGameTools(page);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((ok) => {
          const r = indexedDB.open('heijinwangchao');
          r.onsuccess = () => ok(r.result);
        });
        try {
          return await new Promise<string>((ok) => {
            const r = db.transaction('drafts').objectStore('drafts').get(id);
            r.onsuccess = () => ok(r.result?.story?.narrative ?? r.result?.failures?.at(-1)?.errorCode ?? '');
          });
        } finally {
          db.close();
        }
      }, id),
    )
    .toBe(expected);
}
async function copyStoryReport(page: Page, mobileFailure = false) {
  if (mobileFailure) {
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '重试与变更详情' }) });
    await dialog.getByRole('tab', { name: '模型原文' }).click();
    await dialog.getByText('查看四阶段模型完整原文与执行结果', { exact: true }).click();
    await dialog.locator('summary').filter({ hasText: /^正文模型原文/ }).click();
  } else {
    await openStageRaw(page, 'story');
  }
  await page.getByRole('button', { name: '复制本次诊断' }).click();
  return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
}
for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true])
    test(protocol + ' ' + (stream ? 'SSE' : 'JSON') + ' 正式游戏、主脚本和候选', async ({ page, context }, info) => {
      const sent = await prepare(page, protocol, stream, true);
      await generate(page);
      expect(sent).toHaveLength(1);
      const body = JSON.parse(sent[0]);
      const names =
        protocol === 'gemini'
          ? body.tools[0].functionDeclarations.map((t: { name: string }) => t.name)
          : protocol === 'anthropic'
            ? body.tools.map((t: { name: string }) => t.name)
            : body.tools.map((t: { function: { name: string } }) => t.function.name);
      expect(names).toEqual(expect.arrayContaining(['wave_context_reference', toolName]));
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const report = await copyStoryReport(page);
      expect(report).toMatchObject({ candidateSaved: true, tavern: { calls: 1, restored: true, complete: true } });
      expect(report.tavern.timeline.firstArgumentsMs).toBeGreaterThanOrEqual(report.tavern.timeline.firstByteMs);
      expect(report.draftSavedMs).toBeGreaterThanOrEqual(report.tavern.timeline.upstreamCompleteMs);
      await info.attach('timeline', { body: JSON.stringify(report.tavern.timeline), contentType: 'application/json' });
      expect(sent[0]).toContain('林舟');
    });
}
async function runtimeSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const back = dialog.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name: '运行', exact: true }).click();
  return dialog;
}
async function applyMode(page: Page, dialog: Locator) {
  await Promise.all([page.waitForNavigation(), dialog.getByRole('button', { name: '保存预设并刷新' }).click()]);
}

for (const mode of ['原生破甲', '文学预设']) {
  test(`${mode}和玩家世界书同时进入正式 Story`, async ({ page }) => {
    const sent = await prepare(page, 'openai', false, mode === '文学预设');
    if (mode === '原生破甲') {
      const settings = await runtimeSettings(page);
      await settings.getByLabel('防截断破甲模式').check();
      await applyMode(page, settings);
    }
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '世界书', exact: true }).click();
    const reference = '码头边有一座蓝顶值班室。{{user}}';
    const book = { name: '码头档案', entries: { '1': { uid: 1, constant: true, content: reference } } };
    await settings.getByLabel('选择世界书文件').setInputFiles({ name: 'pier.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
    await expect(settings.getByRole('checkbox', { name: '启用整本「码头档案」', exact: true })).toBeChecked();
    await settings.getByRole('button', { name: '关闭资料界面' }).click();
    expect(sent).toHaveLength(0);

    await generate(page);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]);
    expect(body.messages.filter((message: { content: string }) => message.content.startsWith('<PLAYER_WORLDBOOK>'))).toEqual([
      { role: 'user', content: expect.stringContaining(reference) },
    ]);
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['wave_context_reference', toolName]);
    expect(body.tools[0].function.description).not.toContain(reference);
  });
}

for (const protocol of ['openai','deepseek','gemini','anthropic'] as const) {
  for (const stream of [false, true]) test('原生交付使用渠道参数并保存正文 ' + protocol + (stream ? ' SSE' : ' JSON'), async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sent = await prepare(page, protocol, stream, false, false, playerAction);
    await page.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('heijin.ai.v1')!);
      config.channels[0].parameters.temperature = 0;
      localStorage.setItem('heijin.ai.v1', JSON.stringify(config));
    });
    const dialog = await runtimeSettings(page);
    await expect(dialog.getByLabel('防截断破甲模式')).not.toBeChecked();
    await dialog.getByLabel('防截断破甲模式').check();
    await applyMode(page, dialog);
    const frames = page.locator('iframe[data-tavern-script]');
    await expect(frames).toHaveCount(1);
    await expect(frames).toHaveAttribute('data-tavern-script', controls.mainScript);
    expect(sent).toHaveLength(0);
    await generate(page, 'peinture-smoke', warehouseStory);
    expect(sent).toHaveLength(1);
    expect(await copyStoryReport(page)).toMatchObject({storyValidated: true, candidateSaved: true,
      tavern: {calls: 1, restored: true, complete: true}});
    const body = JSON.parse(sent[0]);
    const tools = protocol === 'gemini' ? body.tools[0].functionDeclarations
      : protocol === 'anthropic' ? body.tools : body.tools.map((t: {function: unknown}) => t.function);
    const names = tools.map((t: {name: string}) => t.name);
    expect(names).toEqual(['wave_context_reference', toolName]);
    const choice = body.toolConfig?.functionCallingConfig.mode ?? body.tool_choice?.type ?? body.tool_choice;
    expect(choice).toBe(protocol === 'gemini' ? 'AUTO' : 'auto');
    const schema = tools[1].parameters ?? tools[1].parametersJsonSchema ?? tools[1].input_schema;
    expect(schema).toMatchObject({type: 'object', properties: {content: {type: 'string'}}, required: ['content']});
    const outgoing = body.messages ?? body.contents;
    const last = outgoing.at(-1);
    expect(last.role).toBe('user');
    const lastText = last.parts?.[0].text ?? last.content;
    const control = 'Call the `actual_content` function exactly once';
    expect(lastText).not.toContain('回应其中最新的真实用户输入');
    expect(lastText).toContain('PLAYER_ACTION');
    expect(lastText.indexOf(control)).toBeGreaterThan(lastText.indexOf('PLAYER_ACTION'));
    expect(JSON.stringify(outgoing).split(control)).toHaveLength(2);
    expect(JSON.stringify(outgoing)).not.toContain(playerAction);
    const [facts, current] = readReference(tools[0].description);
    expect(current).toEqual({ CURRENT_TURN: { source: 'draft.userInput', turnId: 'fixture-turn',
      draftRevision: 0, turnKind: 'opening' }, PLAYER_ACTION: playerAction });
    expect(facts.SAVE_STATE.protagonist.name).toBe('林舟');
    expect(facts.CREATION_PROFILE.protagonist).toEqual(facts.SAVE_STATE.protagonist);
    expect(facts.MEMORY_CONTEXT.recentTurns).toEqual([]);
    expect(facts.NPC_CONTEXT.policy).toBeTruthy();
    expect(tools[0].description).not.toContain('NPC_KNOWLEDGE_POLICY');
    const messages = JSON.stringify(body.messages ?? body.contents);
    expect(messages).toContain('NPC_KNOWLEDGE_POLICY');
    expect(messages).not.toMatch(/WAVE_CONTEXT_BEGIN|<wave_plan>|<wave_writing_tail>/u);
    const temperature = body.generationConfig?.temperature ?? body.temperature;
    expect(temperature).toBe(0);
    const maxOutput = body.generationConfig?.maxOutputTokens ?? body.max_completion_tokens ?? body.max_tokens;
    expect(maxOutput).toBe(8192);
    await info.attach('native-delivery-wire', { contentType: 'application/json',
      body: JSON.stringify({ protocol, stream, names, choice, calls: sent.length, temperature, maxOutput,
        lastRole: last.role, boundActionMatches: current.PLAYER_ACTION === playerAction,
        referenceWorldState: Boolean(facts.SAVE_STATE), candidate: 'saved' }) });
  });
}

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) test(`普通回合与显式重生成读取本轮资料 ${protocol} ${stream ? 'SSE' : 'JSON'}`, async ({page, context, isMobile}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sent = await prepare(page, protocol, stream, false, false, museumAction, true);
    const dialog = await runtimeSettings(page);
    await dialog.getByLabel('防截断破甲模式').check();
    await applyMode(page, dialog);
    await generate(page, 'peinture-smoke', 'rejected', '生成本回合正文');
    expect(sent).toHaveLength(1);
    if (isMobile) {
      const failure = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: '重试与变更详情'})});
      await failure.getByRole('button', {name: '关闭资料界面'}).click();
    }
    await generate(page, 'peinture-smoke', museumStory, '生成本回合正文');
    expect(sent).toHaveLength(2);
    expect(await copyStoryReport(page)).toMatchObject({storyValidated: true, candidateSaved: true,
      tavern: {calls: 1, restored: true, complete: true}});
    for (const [index, wire] of sent.entries()) {
      const body = JSON.parse(wire);
      const tools = protocol === 'gemini' ? body.tools[0].functionDeclarations
        : protocol === 'anthropic' ? body.tools : body.tools.map((t: {function: unknown}) => t.function);
      const [facts, current] = readReference(tools[0].description);
      expect(facts.MEMORY_CONTEXT.recentTurns[0].narrative).toBe(playerAction);
      expect(current.PLAYER_ACTION).toBe(museumAction);
      expect(current.CURRENT_TURN).toMatchObject({turnId: 'museum-turn', source: 'draft.userInput', turnKind: 'regular'});
      expect(current.CURRENT_TURN.draftRevision).toBe(index);
      expect(JSON.stringify(body.messages ?? body.contents)).not.toContain(museumAction);
    }
  });
}

test('原生模式、文学预设和关闭状态在双端保存后互斥', async ({ page }, info) => {
  const sent = await prepare(page, 'openai', false, false);
  let dialog = await runtimeSettings(page);
  const checkbox = () => dialog.getByLabel('防截断破甲模式');
  await checkbox().check();
  await applyMode(page, dialog);
  dialog = await runtimeSettings(page);
  await expect(checkbox()).toBeChecked();
  await checkbox().scrollIntoViewIfNeeded();
  await expect(checkbox()).toBeInViewport();
  await info.attach('原生开启', { body: await page.screenshot({path: info.outputPath('native-on.png')}), contentType: 'image/png' });
  await dialog.getByLabel('正文预设').selectOption(pack);
  await applyMode(page, dialog);
  dialog = await runtimeSettings(page);
  await expect(checkbox()).toBeDisabled();
  await expect(checkbox()).not.toBeChecked();
  await expect(dialog.getByText('使用文学预设时此模式关闭。关闭预设后可手动开启。')).toBeVisible();
  await expect(page.locator('iframe[data-tavern-script="' + controls.mainScript + '"]')).toHaveCount(1);
  await checkbox().scrollIntoViewIfNeeded();
  await info.attach('文学预设启用', { body: await page.screenshot({path: info.outputPath('literary-on.png')}), contentType: 'image/png' });
  await dialog.getByLabel('正文预设').selectOption('');
  await applyMode(page, dialog);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  dialog = await runtimeSettings(page);
  await expect(checkbox()).toBeEnabled();
  await expect(checkbox()).not.toBeChecked();
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).tools).toBeUndefined();
});
test('另一标签启用文学预设后旧页面显示关闭并提示刷新', async ({ page, context }) => {
  const sent = await prepare(page, 'openai', false, false);
  let dialog = await runtimeSettings(page);
  await dialog.getByLabel('防截断破甲模式').check();
  await applyMode(page, dialog);
  dialog = await runtimeSettings(page);
  const other = await context.newPage();
  await other.goto('/');
  const otherSettings = await runtimeSettings(other);
  await otherSettings.getByLabel('正文预设').selectOption(pack);
  await applyMode(other, otherSettings);
  await expect(dialog.getByLabel('防截断破甲模式')).toBeDisabled();
  await expect(dialog.getByText('正文设置已在另一页面更改，请保存并刷新后生成。')).toBeVisible();
  await applyMode(page, dialog);
  await expect(page.locator('iframe[data-tavern-script="' + controls.mainScript + '"]')).toHaveCount(1);
  expect(sent).toHaveLength(0);
});
async function editPreset(page: Page) {
  const settings = await runtimeSettings(page);
  await settings.getByRole('button', { name: '王朝预设设置' }).click();
  return page.getByRole('dialog', { name: '王朝预设设置' });
}
function sectionButton(panel: Locator, name: string) {
  return panel.getByRole('navigation', { name: '预设设置分区' }).getByRole('button').filter({
    has: panel.page().getByText(name, { exact: true }),
  });
}
function delivery(panel: Locator, name: string) {
  return panel.getByRole('group', { name: '正文交付' }).getByRole('button', { name, exact: true });
}
function paceGroup(panel: Locator) { return panel.getByRole('group', { name: '推进速度', exact: true }); }
test('设置保存、重开、恢复默认和关闭，每次仅生成一次', async ({ page }, info) => {
  test.slow(); // Two saves, two real opening drafts and multiple full page reloads.
  const sent = await prepare(page, 'openai', false, false);
  let settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption(pack);
  await Promise.all([
    page.waitForNavigation(),
    settings.getByRole('button', { name: '保存预设并刷新' }).click(),
  ]);
  let panel = await editPreset(page);
  const temp = await panel.getByLabel('温度', { exact: true }).inputValue();
  await sectionButton(panel, '局势与节奏').click();
  const pace = paceGroup(panel);
  const initial = await pace.getByRole('button', { pressed: true }).getAttribute('aria-label')
    ?? await pace.getByRole('button', { pressed: true }).evaluate(button =>
      [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
  await sectionButton(panel, '采样与输出').click();
  await delivery(panel, '文本标记').click();
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await panel.getByRole('button', { name: '关闭预设设置' }).click();
  await settings.getByRole('button', { name: '王朝预设设置' }).click();
  await expect(delivery(panel, '文本标记')).toHaveAttribute('aria-pressed', 'true');
  await delivery(panel, '工具参数').click();
  await sectionButton(panel, '局势与节奏').click();
  await pace.getByRole('button', { name: '疾步向前', exact: true }).click();
  await sectionButton(panel, '采样与输出').click();
  await panel.getByLabel('温度', { exact: true }).fill('0');
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  expect(await panel.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
  await sectionButton(panel, '采样与输出').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.reload();
  panel = await editPreset(page);
  await sectionButton(panel, '局势与节奏').click();
  await expect(paceGroup(panel).getByRole('button', { name: '疾步向前', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sectionButton(panel, '采样与输出').click();
  await expect(panel.getByLabel('温度', { exact: true })).toHaveValue('0');
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).temperature).toBe(0);
  expect(sent[0]).toContain('当前推进速度：疾步向前');
  await page.goto('/');
  panel = await editPreset(page);
  const reset = panel.getByRole('button', { name: '恢复默认', exact: true });
  await reset.click();
  const confirmation = panel.getByRole('region', { name: '确认恢复默认' });
  await expect(confirmation).toContainText('点击保存后生效');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(reset).toBeFocused();
  await expect(panel.getByLabel('温度', { exact: true })).toHaveValue('0');
  await reset.click();
  await confirmation.getByRole('button', { name: '确认恢复默认', exact: true }).click();
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await page.reload();
  panel = await editPreset(page);
  await sectionButton(panel, '局势与节奏').click();
  await expect(paceGroup(panel).getByRole('button', { name: initial, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sectionButton(panel, '采样与输出').click();
  await expect(panel.getByLabel('温度', { exact: true })).toHaveValue(temp);
  await page.goto('/');
  await generate(page, 'peinture-second');
  expect(sent[1]).toContain('顾乙');
  expect(sent).toHaveLength(2);
  expect(JSON.parse(sent[1]).temperature).toBe(Number(temp));
  expect(sent[1]).not.toContain('当前推进速度：疾步向前');
  await page.goto('/');
  settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption('');
  await Promise.all([
    page.waitForNavigation(),
    settings.getByRole('button', { name: '保存预设并刷新' }).click(),
  ]);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  expect(sent).toHaveLength(2);
});

test('保存失败保留编辑，脚本正文交付偏好随下一次请求生效', async ({ page }) => {
  const sent = await prepare(page, 'openai', false, true);
  await page.goto('/#game/peinture-smoke');
  await openGameTools(page);
  await page.getByRole('button', { name: '王朝预设设置', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '王朝预设设置' });
  await sectionButton(panel, '兼容与预览').click();
  await panel.getByRole('button', { name: '估算已保存配置' }).click();
  await expect(panel.getByRole('status')).toContainText('本地估算');

  await sectionButton(panel, '采样与输出').click();

  await delivery(panel, '文本标记').click();
  await panel.getByLabel('还原额外转义').check();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'heijin.story-presets.v1') {
        Storage.prototype.setItem = set;
        throw new Error('合成存储失败');
      }
      set.call(this, k, v);
    };
  });
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('alert')).toContainText('合成存储失败');
  await expect(delivery(panel, '文本标记')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await page.goto('/');
  await editPreset(page);
  await expect(panel.getByLabel('还原额外转义')).toBeChecked();
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page, 'peinture-second');
  expect(sent[0]).toContain('顾乙');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('<wave_delivery>');
  expect(JSON.parse(sent[0]).tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain(
    toolName,
  );
});

for (const format of ['json', 'sse', 'interrupted', 'invalid-story'] as const) {
  test('实际正文标记及本次诊断 ' + format, async ({ page, context }, testInfo) => {
    const requestedStream = format !== 'sse';
    const sent = await prepare(page, 'openai', requestedStream, true, true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#game/peinture-smoke');
    await openGameTools(page);
    await page.getByRole('button', { name: '王朝预设设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '王朝预设设置' });
    await delivery(panel, '文本标记').click();
    await panel.getByRole('button', { name: '保存调整' }).click();
    await expect(panel.getByRole('status')).toContainText('已保存');
    await panel.getByRole('button', { name: '关闭预设设置' }).click();

    const narrative = ('雨停后，林舟收起伞，望着写有“北岸”的路牌。\n').repeat(80).trim();
    const story = envelope.replace('船靠岸了，林舟沿着石阶往上走。', narrative)
      + '<行动选项>留在原地\n看看周围\n询问站台</行动选项>';
    // 辅助变量规划允许原文参考，空的必需短期记忆仍应由 Story 校验拒绝。
    const content = '<wave_delivery>' + (format === 'invalid-story' ? story.replace('林舟上岸</短期记忆>', ' </短期记忆>') : story) + '</wave_delivery>';
    const json = format === 'json' || format === 'invalid-story';
    await page.route('https://peinture.mock.invalid/**', route => {
      sent.push(route.request().postData()!);
      const data = { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 123 } };
      const chunk = { choices: [{ delta: { content }, finish_reason: format === 'interrupted' ? null : 'stop' }] };
      return route.fulfill({
        contentType: format === 'sse' ? 'application/json' : 'text/plain',
        body: json ? JSON.stringify(data) : 'data: ' + JSON.stringify(chunk) + '\n\n',
      });
    });
    await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
    const success = format === 'json' || format === 'sse';
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(ok => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => ok(request.result);
      });
      try {
        return await new Promise<string>(ok => {
          const request = db.transaction('drafts').objectStore('drafts').get('peinture-smoke');
          request.onsuccess = () => ok(request.result.story?.narrative ?? (request.result.failures.length ? 'failed' : ''));
        });
      } finally { db.close(); }
    })).toBe(success ? narrative : 'failed');
    const report = await copyStoryReport(page, !success && testInfo.project.name === 'mobile');
    expect(report).toMatchObject({
      protocol: 'openai', tavern: { requestedStream, normalized: json ? 'json' : 'sse', calls: 1, complete: format !== 'interrupted' },
      candidateSaved: success, storyValidated: success,
    });
    const timing = report.tavern.timeline;
    expect(timing.sentMs).toBeGreaterThanOrEqual(timing.budgetStartMs);
    expect(timing.headersMs).toBeGreaterThanOrEqual(timing.sentMs);
    expect(timing.firstByteMs).toBeGreaterThanOrEqual(timing.headersMs);
    expect(timing.firstContentMs).toBeGreaterThanOrEqual(timing.firstByteMs);
    if (success) {
      expect(report.validationEndMs).toBeGreaterThanOrEqual(timing.restoredMs);
      expect(report.draftSavedMs).toBeGreaterThanOrEqual(report.validationEndMs);
    }
    if (format === 'interrupted') expect(report).toMatchObject({ code: 'stream_interrupted', fieldPath: 'tavern.upstream.missing_finish', failureLayer: 'upstream' });
    if (format === 'invalid-story') {
      expect(report).toMatchObject({ failureLayer: 'story_validation', tavern: { rawFinish: 'stop', restored: true } });
      expect(report.validationEndMs).toBeGreaterThanOrEqual(timing.restoredMs);
      expect(report.draftSavedMs).toBeUndefined();
    }
    if (json) expect(report.tavern.upstreamUsage.outputTokens).toBe(123);
    expect(JSON.stringify(report)).not.toMatch(/林舟|fixture-only|peinture-smoke|wave_delivery/);
    expect(sent).toHaveLength(1);
    await testInfo.attach('本次诊断', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
}

test('仅有上游心跳时真实脚本按配置超时，失败面板可复制本次时间线', async ({ page, context }, info) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (!String(input).startsWith('https://peinture.mock.invalid/')) return original(input, init);
      sessionStorage.setItem('mock-heartbeat-count', String(Number(sessionStorage.getItem('mock-heartbeat-count') ?? 0) + 1));
      return new Response(new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(': synthetic keepalive\n\n')); },
        cancel() { sessionStorage.setItem('mock-heartbeat-cleanup', 'released'); },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
  });
  await prepare(page, 'openai', true, true);
  await page.evaluate(key => {
    const settings = JSON.parse(localStorage.getItem(key)!);
    settings.runtime.timeoutSeconds = 1;
    localStorage.setItem(key, JSON.stringify(settings));
  }, fixture.settingsKey);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.reload();
  await page.goto('/#game/peinture-smoke');
  await openGameTools(page);
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('mock-heartbeat-cleanup'))).toBe('released');
  const report = await copyStoryReport(page, info.project.name === 'mobile');
  expect(report).toMatchObject({ code: 'timeout', failureLayer: 'upstream', candidateSaved: false, storyValidated: false,
    tavern: { calls: 1, complete: false, readerEof: false, upstreamStatus: 200, timeline: {
      timeoutSeconds: 1, deadlinePhase: 'upstream_read', comments: 1, dataEvents: 0, byteChunks: 1,
    } },
  });
  expect(report.tavern.timeline.firstContentMs).toBeUndefined();
  expect(report.tavern.timeline.deadlineMs - report.tavern.timeline.budgetStartMs).toBeGreaterThanOrEqual(995);
  expect(await page.evaluate(() => sessionStorage.getItem('mock-heartbeat-count'))).toBe('1');
  await info.attach('timeline', { body: JSON.stringify(report.tavern.timeline), contentType: 'application/json' });
});

test('预设名片显示仍可用脚本的运行时诊断', async ({ page }) => {
  const sent = await prepare(page, 'openai', false, true);
  const panel = await editPreset(page);
  await expect(panel.getByText('脚本运行中', { exact: true })).toBeVisible();
  // Exercise the same iframe listener in the built app; dist does not serve source modules.
  await page.frameLocator('iframe[data-tavern-script="' + controls.mainScript + '"]').locator('body').evaluate(() => {
    window.setTimeout(() => { throw new TypeError('synthetic-private-error'); }, 0);
  });
  await expect(panel.getByText('脚本运行时异常', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '浪潮 · 状态', exact: true }).click();
  await panel.getByText('我即浪潮 · 已初始化', { exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(/我即浪潮.*运行时异常.*TypeError/u);
  await expect(panel.getByRole('alert')).not.toContainText('synthetic-private-error');
  expect(sent).toHaveLength(0);
});

for (const appearance of ['night', 'day']) test('预设纸档布局与完整条目 ' + appearance, async ({ page }, info) => {
  test.slow();
  const mobile = info.project.name === 'mobile';
  if (!mobile) await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await prepare(page, 'openai', false, true);
  await page.evaluate(value => { document.documentElement.dataset.appearance = value; }, appearance);
  const panel = await editPreset(page);
  const content = panel.getByLabel('预设分区内容');
  const temperature = panel.getByLabel('温度', { exact: true });
  const slider = panel.getByRole('slider', { name: '温度滑块' });
  await expect(temperature).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('preset-' + appearance + '.png') });
  await temperature.fill('0.4');
  await expect(slider).toHaveValue('0.4');
  await slider.press('End');
  await expect(temperature).toHaveValue((await temperature.getAttribute('max'))!);
  await temperature.fill('3');
  await panel.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('温度须在 0 到 2 之间。');
  await expect(temperature).toHaveValue('3');
  await temperature.fill('0.4');
  const contrast = [await settingsTextContrast(panel)];
  const initialStorage = await page.evaluate(() => localStorage.getItem('heijin.story-presets.v1'));
  const allDisplayed: string[] = [];
  const grouped = new Set(controls.groups.flatMap(group => group.ids));
  for (const section of controls.sections) {
    await sectionButton(panel, section.name).click();
    await expect(content.getByRole('heading', { name: section.name, exact: true })).toBeVisible();
    await expect(sectionButton(panel, section.name).locator('.peinture-count')).toHaveText(new RegExp('/' + section.ids.length + '$'));
    // A custom style is counted under 自定义, but belongs to the full 文风 radio group.
    const options = controls.groups.filter(group => section.ids.includes(group.ids[0])).flatMap(group => group.ids);
    const displayed = await content.locator('input[type=checkbox], .peinture-chips button[value]').evaluateAll(
      elements => elements.map(element => element.getAttribute('value') ?? '').sort(),
    );
    expect(displayed).toEqual([...section.ids.filter(id => !grouped.has(id)), ...options].sort());
    allDisplayed.push(...displayed);
    if (section.name === '局势与节奏') {
      const group = paceGroup(panel);
      await group.getByRole('button', { name: '疾步向前', exact: true }).click();
      await expect(group.getByRole('button', { pressed: true })).toHaveText('疾步向前');
      await group.getByRole('button', { name: '不指定', exact: true }).press('Enter');
      await expect(group.getByRole('button', { pressed: true })).toHaveText('不指定');
      await expect(sectionButton(panel, section.name).getByTitle('有未保存的修改')).toBeVisible();
      contrast.push(await settingsTextContrast(panel));
      await page.screenshot({ animations: 'disabled', path: info.outputPath('preset-groups-' + appearance + '.png') });
    }
    if (section.name === '自定义') {
      await expect(content.locator('textarea')).toHaveCount(4);
      await content.locator('textarea').last().fill('合成测试文字');
      await expect(content.locator('textarea').last()).toHaveValue('合成测试文字');
    }
  }
  expect(allDisplayed).toHaveLength(85);
  expect(allDisplayed.sort()).toEqual(controls.sections.flatMap(section => section.ids).sort());
  if (!mobile) {
    const search = panel.getByRole('searchbox', { name: '搜索预设条目' });
    await search.fill('疾步向前');
    await expect(paceGroup(panel)).toBeVisible();
    await search.fill('无匹配测试42');
    await expect(content).toContainText('没有匹配的条目。');
    await search.fill('');
    await expect(content.getByRole('heading', { name: '自定义', exact: true })).toBeVisible();
  }
  for (const viewport of mobile ? [{ width: 375, height: 520 }, { width: 392, height: 420 }]
    : [{ width: 859, height: 600 }, { width: 1024, height: 520 }]) {
    await page.setViewportSize(viewport);
    await sectionButton(panel, '自定义').click();
    const lastInput = content.locator('textarea').last();
    await lastInput.click();
    await lastInput.fill('矮视口编辑');
    await expect(lastInput).toHaveValue('矮视口编辑');
    const reset = panel.getByRole('button', { name: '恢复默认', exact: true });
    await expect(reset).toBeInViewport();
    await reset.click();
    const confirmation = panel.getByRole('region', { name: '确认恢复默认' });
    await expect(confirmation.getByRole('button', { name: '确认恢复默认', exact: true })).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`preset-short-${appearance}-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
    await expect(confirmation).not.toBeVisible();
    await expect(reset).toBeFocused();
    const save = panel.getByRole('button', { name: '保存调整', exact: true });
    await expect(save).toBeInViewport();
    if (viewport.width < 860) {
      const actions = await panel.locator('.peinture-actions').boundingBox();
      expect(Math.abs((await reset.boundingBox())!.width - (await save.boundingBox())!.width)).toBeLessThan(1);
      expect(actions!.width).toBeGreaterThan(viewport.width - 44);
    }
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await writeFile(info.outputPath('preset-contrast.json'), JSON.stringify(contrast.map(result => ({
    text: result.rows.map(({ text, ratio, threshold, foreground, background }) => ({ text, ratio, threshold, foreground, background })),
    controls: result.controls,
  })), null, 2));
  expect(contrast.flatMap(result => result.failures.map(({text, ratio}) => ({text, ratio})))).toEqual([]);
  expect(contrast.flatMap(result => result.controlFailures)).toEqual([]);
  const close = panel.getByRole('button', { name: '关闭预设设置' });
  page.once('dialog', dialog => dialog.dismiss());
  await close.click();
  await expect(panel).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await close.click();
  await expect(panel).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('heijin.story-presets.v1'))).toBe(initialStorage);
  expect(sent).toHaveLength(0);
});

async function choose1124(page: Page) {
  const settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption('peinture-1124');
  await applyMode(page, settings);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(3);
}

function textDelivery(protocol: Protocol, stream: boolean, content: string) {
  if (protocol === 'gemini') {
    const json = {candidates:[{content:{role:'model',parts:[{text:content}]},finishReason:'STOP'}]};
    return stream ? {contentType:'text/event-stream',body:'data: ' + JSON.stringify(json) + '\n\n'} : {json};
  }
  let frames: unknown[];
  if (protocol === 'anthropic') {
    if (!stream) return {json:{content:[{type:'text',text:content}],stop_reason:'end_turn'}};
    frames = [{type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:content}}, {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:12}}, {type:'message_stop'}];
  } else {
    if (!stream) return {json:{choices:[{message:{content},finish_reason:'stop'}]}};
    frames = [{choices:[{index:0,delta:{content},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]}];
  }
  return {contentType:'text/event-stream',body:frames.map(frame => 'data: '+JSON.stringify(frame)+'\n\n').join('') +
    (protocol === 'anthropic' ? '' : 'data: [DONE]\n\n')};
}

for (const protocol of ['openai','deepseek','gemini','anthropic'] as const) {
  for (const stream of [false,true]) test(`C1 1124 空行动开局 ${protocol} ${stream ? 'SSE' : 'JSON'}`, async ({page}, info) => {
    await prepare(page, protocol, stream, false);
    await choose1124(page);
    const received: string[] = [];
    await page.route('https://peinture.mock.invalid/**', route => {
      const wire = route.request().postData()!;
      received.push(wire);
      const body = JSON.parse(wire);
      const declarations = protocol === 'gemini' ? body.tools?.[0]?.functionDeclarations : protocol === 'anthropic' ? body.tools :
        body.tools?.map((t:{function:unknown}) => t.function);
      if (declarations?.some((t:{name:string}) => t.name === toolName)) return route.fulfill(upstream(protocol,stream));
      const content = wire.includes('<wave_delivery>') ? '<wave_delivery>'+envelope+'</wave_delivery>' : envelope;
      return route.fulfill(textDelivery(protocol,stream,content));
    });
    await generate(page);
    expect(received).toHaveLength(1);
    const { tools, ...messages } = JSON.parse(received[0]);
    for (const fact of ['林舟', '中国城市与地域差异']) expect(JSON.stringify(messages)).toContain(fact);
    await writeFile(info.outputPath('opening.json'), JSON.stringify({protocol,stream,device:info.project.name,
      bytes:Buffer.byteLength(received[0]),tools:tools ?? [],posts:received.length,saved:true}));
  });
}

for (const version of ['1118', '1124']) {
  for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
    for (const stream of [false, true]) test(`C1 出站对照 ${version} ${protocol} ${stream ? 'SSE' : 'JSON'}`, async ({page}, info) => {
      test.slow();
      const sent = await prepare(page, protocol, stream, version === '1118', false, museumAction, true, true);
      if (version === '1124') await choose1124(page);
      await generate(page, 'peinture-smoke', undefined, '生成本回合正文');
      expect(sent).toHaveLength(1);
      const { tools, ...messages } = JSON.parse(sent[0]);
      const declarations = protocol === 'gemini' ? tools[0].functionDeclarations : protocol === 'anthropic' ? tools :
        tools.map((tool: {function:unknown}) => tool.function);
      const ref = declarations.find((t: {name:string}) => t.name === 'wave_context_reference').description as string;
      expect(ref).toContain(museumAction);
      expect(ref).toContain(playerAction);
      const direct = JSON.stringify(messages);
      const facts = ['林舟', '沈潮汐', '铜铃封存在第三座灯塔', '2026-10-18', '中国城市与地域差异'];
      if (version === '1124') {
        expect(direct).toContain('正文落点约900字');
        expect(direct).toContain('上一楼可计正文约25字');
      }
      const fields = facts.map(value => ({ value, messages:direct.includes(value), reference:ref.includes(value) }));
      for (const fact of fields) {
        expect(fact.reference, fact.value).toBe(version === '1118');
        if (version === '1124') expect(fact.messages, fact.value).toBe(true);
      }
      expect(declarations.map((t:{name:string}) => t.name)).toContain('actual_content');
      const evidence = {version, protocol, stream, device:info.project.name, posts:sent.length,
        sha256:createHash('sha256').update(sent[0]).digest('hex'), bytes:Buffer.byteLength(sent[0]),
        fields, referenceHistory:playerAction, referenceAction:museumAction, saved:'船靠岸了，林舟沿着石阶往上走。'};
      expect(sent[0].includes('fixture-only')).toBe(false);
      await writeFile(info.outputPath('wire-proof.json'), JSON.stringify(evidence,null,2));
      await writeFile(info.outputPath('mock-body.json.gz'), gzipSync(sent[0]));
    });
  }
}

test('C1 1124 潮汐控制台编辑、只读时序、Token 与独立配色', async ({page}, info) => {
  test.slow();
  const sent = await prepare(page,'openai',false,false,false,museumAction,true,true);
  await choose1124(page);
  await page.goto('/#game/peinture-smoke');
  let panel = await editPreset(page);
  await sectionButton(panel,'主线时序').click();
  await expect(panel).toContainText('2026-10-18');
  await page.evaluate(() => { location.hash = '#game/peinture-second'; });
  await expect(panel).toContainText('2031-03-09');
  await expect(panel).not.toContainText('2026-10-18');
  await page.evaluate(() => { location.hash = '#game/peinture-smoke'; });
  await expect(panel).toContainText('2026-10-18');
  await sectionButton(panel,'兼容与预览').click();
  await panel.getByRole('button',{name:'估算已保存配置'}).click();
  await expect(panel.getByRole('status')).toContainText('Token');
  await sectionButton(panel,'篇幅与文风').click();
  const style = panel.getByRole('group',{name:'文风',exact:true});
  await style.getByRole('button',{name:'意识流',exact:true}).click();
  await expect(style.getByRole('button',{pressed:true})).toHaveCount(1);
  await panel.getByText('编辑本组条目',{exact:true}).click();
  await panel.getByLabel('文学条目',{exact:true}).selectOption('wave-style-stream-of-consciousness');
  const editor = panel.getByLabel('条目正文',{exact:true});
  await editor.fill((await editor.inputValue()) + '\n本场文风校样：灯火随潮。');
  await sectionButton(panel,'互动与视角').click();
  const view = panel.getByRole('group',{name:'视角',exact:true});
  await expect(view.locator('[value="wave-person-first"]')).toHaveAttribute('aria-pressed','true');
  await expect(view.locator('[value="wave-person-third"]')).toBeDisabled();
  await sectionButton(panel,'我的方案').click();
  await panel.getByLabel('方案名称').fill('海港校样');
  await panel.getByRole('button',{name:'保存当前方案'}).click();
  await panel.getByRole('button',{name:'调用',exact:true}).click();
  await panel.getByRole('button',{name:'载入编辑区'}).click();
  await expect(panel.getByRole('status')).toContainText('略过 0 项');
  await sectionButton(panel,'潮汐外观').click();
  await panel.getByLabel('浪潮标识').selectOption('classic');
  await expect(panel.locator('svg.tide-mark')).toBeVisible();
  await panel.getByLabel('浪潮标识').selectOption('harbor');
  await sectionButton(panel,'采样与输出').click();
  await panel.getByLabel('温度',{exact:true}).fill('0.63');
  await panel.getByRole('button',{name:'保存调整'}).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  for (let n=0;n<2;n++) {
    await panel.getByRole('button',{name:'切换潮汐明暗配色'}).click();
    const theme = await panel.evaluate(el => el.classList.contains('tide-day') ? 'day' : 'night');
    await page.screenshot({animations:'disabled',path:info.outputPath('tide-'+theme+'.png')});
    expect(await panel.evaluate(el=>el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.reload();
  panel = await editPreset(page);
  await sectionButton(panel,'篇幅与文风').click();
  await expect(panel.getByRole('button',{name:'意识流',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(sent).toEqual([]);
  await page.goto('/');
  await generate(page,'peinture-smoke',undefined,'生成本回合正文');
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).temperature).toBe(0.63);
  expect(sent[0]).toContain('本场文风校样：灯火随潮。');
  await page.goto('/');
  await generate(page,'peinture-second',undefined,'生成本回合正文');
  expect(sent[1]).toContain('顾乙');
  await page.goto('/');
  const settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption(pack);
  await applyMode(page, settings);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(2);
  const previous = await editPreset(page);
  await expect(previous.getByLabel('温度',{exact:true})).toHaveValue('1');
});

for (const failure of ['content_filter','stream_interrupted'] as const) test('C1 1124 上游失败保留正式状态 '+failure,async({page})=>{
  const posted = await prepare(page,'openai',failure==='stream_interrupted',false,false,museumAction,true,true);
  await choose1124(page);
  let count = 0;
  await page.route('https://peinture.mock.invalid/**', route=>{
    count++;
    if (failure==='content_filter') return route.fulfill({json:{choices:[{message:{refusal:'test refusal'},finish_reason:'content_filter'}]}});
    return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{index:0,delta:{content:'半段文字'},finish_reason:null}]})+'\n\n'});
  });
  await generate(page,'peinture-smoke',failure,'生成本回合正文');
  const persisted=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('heijinwangchao');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {
      const tx=db.transaction(['saves','drafts'],'readonly');
      const [state,draft]=await Promise.all(['saves','drafts'].map(store=>new Promise((resolve,reject)=>{
        const r=tx.objectStore(store).get('peinture-smoke');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      }))) as [{revision:number},{story?:unknown;storyRevision:number}];
      return {revision:state.revision,storyRevision:draft.storyRevision,story:draft.story??null};
    } finally { db.close(); }
  });
  expect(persisted).toEqual({revision:1,storyRevision:0,story:null});
  expect([posted.length,count]).toEqual([0,1]);
});

test('复审：1118 原控制台方案导入、保存、刷新，散文进入下一次实际请求', async ({page}, info) => {
  test.slow();
  const sent = await prepare(page,'openai',false,false,false,museumAction,true,true);
  await choose1124(page);
  await page.goto('/#game/peinture-smoke');
  let panel = await editPreset(page);
  await sectionButton(panel,'篇幅与文风').click();
  await panel.getByRole('button',{name:'意识流',exact:true}).click();
  await panel.getByRole('button',{name:'保存调整'}).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await sectionButton(panel,'我的方案').click();
  const buffer = gunzipSync(await readFile('e2e/fixtures/peinture-1118-essay.json.gz'));
  const file = {name:'1118码头散文.json',mimeType:'application/json',buffer};
  await panel.getByLabel('导入方案 JSON').setInputFiles(file);
  await panel.getByRole('button',{name:'取消',exact:true}).click();
  await sectionButton(panel,'篇幅与文风').click();
  await expect(panel.getByRole('button',{name:'意识流',exact:true})).toHaveAttribute('aria-pressed','true');
  await sectionButton(panel,'我的方案').click();
  await panel.getByLabel('导入方案 JSON').setInputFiles(file);
  await panel.getByRole('button',{name:'载入编辑区'}).click();
  await expect(panel.getByRole('status')).toContainText('已载入 85 项');
  await panel.getByRole('button',{name:'保存调整'}).click();
  await expect(panel.getByRole('status').filter({hasText:'已保存'})).toBeVisible();
  await page.reload();
  panel = await editPreset(page);
  await sectionButton(panel,'篇幅与文风').click();
  await expect(panel.getByRole('button',{name:'散文随笔',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(panel.getByRole('button',{name:'意识流',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page,'peinture-smoke',undefined,'生成本回合正文');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('当前文风：散文随笔');
  expect(sent[0]).toContain('旧方案校样：渡船离岸。');
  expect(sent[0]).not.toContain('当前文风：意识流');
  await writeFile(info.outputPath('scheme-wire.json'),JSON.stringify({
    device:info.project.name,schemeSha256:createHash('sha256').update(buffer).digest('hex'),
    requestSha256:createHash('sha256').update(sent[0]).digest('hex'),posts:sent.length,style:'散文随笔',saved:true,
  }));
});
