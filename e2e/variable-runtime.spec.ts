import { variableReply } from '../src/tests/fixtures/variableReply';
import { openGameTools } from './helpers/gameLayout';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const narrative = '主角已经用现金支付30元吃饭。';
const result = {
  commands: [
    {
      type: 'SpendFunds',
      commandId: 'meal',
      evidence: narrative,
      account: 'cash',
      amount: 3000,
      purpose: '午餐',
    },
  ],
  rejectedSuggestions: [{ reason: '普通寒暄不改变好感' }],
  unresolved: ['内部候选事项不可默认公开'],
};
const response = (value: unknown = result) =>
  JSON.stringify({
    choices: [
      {
        message: { content: typeof value === 'string' ? value : variableReply(value) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 61, completion_tokens: 12, total_tokens: 73 },
  });
async function seed(page: Page, ready = true, disabled = false, text = narrative, withNpc = false) {
  await page.goto('/');
  const before = await page.evaluate(
    async ({ ready, disabled, narrative, withNpc }) => {
      const repoPath = '/src/services/storage/saveRepository.ts',
        fixturePath = '/src/tests/fixtures/game.ts';
      const draftsPath = '/src/domain/drafts.ts',
        settingsPath = '/src/ui/settings/model.ts';
      const configPath = '/src/services/ai/configuration.ts',
        vaultPath = '/src/services/ai/credentials.ts';
      const { SaveRepository } = await import(repoPath),
        { game, npc } = await import(fixturePath);
      const { createTurnDraft, rerollStory } = await import(draftsPath);
      const { defaultSettings, settingsKey } = await import(settingsPath);
      const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath);
      const { CredentialVault } = await import(vaultPath);
      const settings = defaultSettings();
      settings.prompts.minNarrativeChars = 10;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const config = defaultAiConfig(),
        channel = newChannel();
      channel.baseUrl = 'https://variables.mock.invalid/v1';
      channel.defaultModel = 'variable-browser-model';
      channel.compatibility.jsonMode = true;
      config.channels = [channel];
      config.routes.story = { channelId: channel.id, modelId: 'story-browser-model' };
      config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: '' };
      saveAiConfig(localStorage, config);
      new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-var-browser-secret');
      const repo = await SaveRepository.open();
      const initialState = { ...game('variable-e2e'), title: '变量阶段测试（隔离）' };
      if (withNpc) {
        initialState.npc = { 'npc-a': npc() };
        initialState.locations.clinic = { id: 'clinic', name: '社区诊所', parentId: 'chongqing' };
      }
      const state = await repo.create(initialState);
      for (const id of ['variable-e2e', 'other-e2e']) {
        if (id !== state.saveId)
          await repo.create({ ...game(id), title: '另一份变量存档（隔离）' });
        const initial = createTurnDraft(
          id,
          0,
          `turn-${id}`,
          'opening',
          '已绑定输入',
          !disabled,
          !disabled,
        );
        await repo.saveDraft(initial, null);
        if (ready)
          await repo.saveDraft(
            rerollStory(initial, {
              turnKind: 'opening',
              narrative,
              summary: '午餐',
              variableGuide: [],
            }),
            0,
          );
      }
      repo.close();
      return JSON.stringify(state);
    },
    { ready, disabled, narrative: text, withNpc },
  );
  await page.goto('/#game/variable-e2e'); await openGameTools(page);
  await page.reload(); await openGameTools(page);
  await expect(page.getByRole('heading', { name: '林舟', exact: true })).toBeVisible();
  return before;
}
async function stored(page: Page, saveId = 'variable-e2e') {
  return page.evaluate(async (id) => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try {
      return { formal: JSON.stringify(await repo.load(id)), draft: await repo.loadDraft(id) };
    } finally {
      repo.close();
    }
  }, saveId);
}
async function ready(page: Page) {
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText(
    '变量已完成 · 候选未正式结算',
  );
}

test('变量正常生成、真实独立路由/模块/usage，完整候选主动查看，刷新仍保留候选且正式资金不变', async ({
  page,
}, info) => {
  const before = await seed(page),
    bodies: Record<string, unknown>[] = [];
  await page.route('https://variables.mock.invalid/**', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', body: response('<说明>内部候选事项不可默认公开</说明>' + variableReply(result)) });
  });
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await ready(page);
  const saved = await stored(page);
  expect(saved.formal).toBe(before);
  expect(saved.draft.variables.result.commands[0].type).toBe('SpendFunds');
  expect(saved.draft.executionRevision).toBe(1);
  expect(saved.draft.story.narrative).toBe(narrative);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].model).toBe('variable-browser-model');
  expect(bodies[0]).not.toHaveProperty('response_format');
  expect(JSON.stringify(bodies[0])).toContain('TURN_CONTEXT');
  expect(JSON.stringify(bodies[0])).toContain('SpendFunds');
  await expect(page.locator('main')).not.toContainText('内部候选事项不可默认公开');
  await page.getByRole('button', { name: '查看变量候选（未结算）', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '变量候选 · 未正式结算', exact: true });
  await expect(modal).toContainText('SpendFunds');
  await expect(modal).not.toContainText('内部候选事项不可默认公开');
  await modal.getByRole('button', { name: '主动查看完整变量候选', exact: true }).click();
  await expect(modal.getByLabel('完整变量候选')).not.toContainText('内部候选事项不可默认公开');
  await expect(modal.getByLabel('完整变量候选')).toContainText('说明未转为命令或存档事实');
  await expect(modal).not.toContainText('mock-var-browser-secret');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('variables');
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const inspection = page.getByRole('region', { name: '上下文与统计' });
  await expect(inspection).toContainText('variable-browser-model');
  await expect(inspection).toContainText('stages.opening.variables.text');
  await expect(inspection).toContainText('61');
  await expect(inspection).toContainText('73');
  await expect(inspection).not.toContainText('mock-var-browser-secret');
  await page.keyboard.press('Escape');
  await page.reload(); await openGameTools(page);
  await ready(page);
  expect((await stored(page)).formal).toBe(before);
  await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText('100.00 元');
  await page.screenshot({ path: info.outputPath('variable-runtime.png'), fullPage: true });
});
test('正文未完成不能运行；双阶段关闭后仅补算变量，正文不 Roll，世界不执行', async ({ page }) => {
  await seed(page, false, true);
  await expect(page.getByRole('button', { name: '启用并补算变量', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts',
      draftPath = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(repoPath),
      { rerollStory } = await import(draftPath);
    const repo = await SaveRepository.open();
    const d = await repo.loadDraft('variable-e2e');
    await repo.saveDraft(
      rerollStory(d, {
        turnKind: 'opening',
        narrative: '主角已经用现金支付30元吃饭。',
        summary: '',
        variableGuide: [],
      }),
      d.draftRevision,
    );
    repo.close();
  });
  await page.reload(); await openGameTools(page);
  await page.getByLabel('动态世界', { exact: true }).uncheck();
  await page.route('https://variables.mock.invalid/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: response() }),
  );
  await page.getByRole('button', { name: '启用并补算变量', exact: true }).click();
  await ready(page);
  const first = await stored(page);
  await page.getByRole('button', { name: '重新生成变量候选', exact: true }).click();
  await ready(page);
  const second = await stored(page);
  expect(second.draft.story).toEqual(first.draft.story);
  expect(second.draft.storyRevision).toBe(first.draft.storyRevision);
  expect(second.draft.variables.candidateRevision).toBeGreaterThan(
    first.draft.variables.candidateRevision,
  );
  expect(second.draft.useWorldStage).toBe(false);
  expect(second.draft.world).toBeUndefined();
});
test('错误 JSON 安全失败可重试；取消、重复点击和切档迟到不串档', async ({ page }) => {
  const before = await seed(page);
  let count = 0,
    mode: 'bad' | 'slow' | 'good' = 'bad';
  await page.route('https://variables.mock.invalid/**', async (route) => {
    count++;
    const current = mode;
    if (current === 'slow') await new Promise((resolve) => setTimeout(resolve, 1200));
    await route
      .fulfill({
        contentType: 'application/json',
        body: response(current === 'bad' ? '{invalid-json' : result),
      })
      .catch(() => undefined);
  });
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await stored(page)).draft.stageStatus.variables).toBe('failed');
  await expect(page.getByTestId('story-reader')).toContainText(narrative);
  mode = 'slow';
  await page
    .getByRole('button', { name: '生成变量候选', exact: true })
    .evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
  await expect.poll(() => count).toBe(2);
  await expect(page.getByRole('button', { name: '重新 Roll', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消变量生成', exact: true }).click();
  mode = 'good';
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await ready(page);
  const saved = await stored(page);
  mode = 'slow';
  await page.getByRole('button', { name: '重新生成变量候选', exact: true }).click();
  await expect.poll(() => count).toBe(4);
  await page.getByRole('button', { name: '切换存档', exact: true }).click();
  await page
    .locator('.save-card')
    .filter({ hasText: '另一份变量存档' })
    .getByRole('button', { name: /读取存档/ })
    .click();
  await openGameTools(page, true);
  mode = 'good';
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await ready(page);
  expect((await stored(page, 'other-e2e')).draft.variables).toBeDefined();
  expect((await stored(page)).formal).toBe(before);
  expect((await stored(page)).draft.story).toEqual(saved.draft.story);
  expect((await stored(page)).draft.variables).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('角色对白后换行的客观消费可保存候选，不改变正式资金', async ({ page }) => {
  const text = `【店员】欢迎光临。\n${narrative}`;
  const before = await seed(page, true, false, text);
  await page.route('https://variables.mock.invalid/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: response() }),
  );
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await ready(page);
  const saved = await stored(page);
  expect(saved.formal).toBe(before);
  expect(saved.draft.story.narrative).toBe(text);
  expect(saved.draft.variables.result.commands[0]).toMatchObject({
    type: 'SpendFunds',
    amount: 3000,
  });
});

test('场景引用不一致整批失败；合法离场可恢复为未结算候选', async ({ page }) => {
  const text = '主角独自走进社区诊所。同事留在重庆。';
  const before = await seed(page, true, false, text, true);
  let follow = true;
  await page.route('https://variables.mock.invalid/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: response({
        commands: [
          {
            type: 'UpdateProtagonist',
            commandId: 'move',
            expectedRevision: 0,
            protagonistId: 'hero',
            evidence: '主角独自走进社区诊所。',
            changes: { locationId: 'clinic' },
          },
          {
            type: 'UpdateNpc',
            commandId: 'npc-move',
            expectedRevision: 0,
            npcId: 'npc-a',
            evidence: follow ? '主角独自走进社区诊所。' : '同事留在重庆。',
            changes: follow ? { onScene: true, locationId: 'chongqing' } : { onScene: false },
          },
        ],
        rejectedSuggestions: [],
        unresolved: [],
      }),
    }),
  );
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const rejected = await stored(page);
  expect(rejected.draft.stageStatus.variables).toBe('failed');
  expect(rejected.draft.variables).toBeUndefined();
  expect(rejected.draft.story.narrative).toBe(text);
  expect(rejected.formal).toBe(before);
  follow = false;
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await ready(page);
  const accepted = await stored(page);
  expect(accepted.draft.variables.result.commands[1].changes).toEqual({ onScene: false });
  expect(accepted.formal).toBe(before);
});

for (const scenario of [
  { kind: 'spend', denied: '主角没用现金支付30元吃饭' },
  { kind: 'spend', denied: '不是主角已经用现金支付30元吃饭' },
  { kind: 'scene', denied: '不是同事和主角一起走进社区诊所' },
  { kind: 'scene', denied: '并非同事和主角一起走进社区诊所' },
] as const) {
  test(`小说否定由模型判断；真正非法数据拒绝后可恢复：${scenario.denied}`, async ({ page }) => {
    const scene = scenario.kind === 'scene';
    const text = scene
      ? `${scenario.denied}。主角独自走进社区诊所，同事留在重庆。`
      : `${scenario.denied}，但主角已经用线上支付30元吃饭。`;
    const before = await seed(page, true, false, text, scene);
    let corrected = false;
    await page.route('https://variables.mock.invalid/**', (route) => {
      const commands = scene
        ? [
            {
              type: 'UpdateProtagonist',
              commandId: 'move',
              expectedRevision: 0,
              protagonistId: 'hero',
              evidence: '主角独自走进社区诊所',
              changes: { locationId: 'clinic' },
            },
            {
              type: 'UpdateNpc',
              commandId: 'npc-move',
              expectedRevision: 0,
              npcId: 'npc-a',
              evidence: corrected ? '同事留在重庆' : '同事和主角一起走进社区诊所',
              changes: corrected ? { onScene: false } : { onScene: true, locationId: 'missing' },
            },
          ]
        : [
            {
              type: 'SpendFunds',
              commandId: 'meal',
              evidence: corrected ? '线上支付30元吃饭' : '现金支付30元吃饭',
              account: corrected ? 'onlineBalance' : 'cash',
              amount: corrected ? 3000 : 999999,
              purpose: '午餐',
            },
          ];
      return route.fulfill({
        contentType: 'application/json',
        body: response({ commands, rejectedSuggestions: [], unresolved: [] }),
      });
    });
    await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const rejected = await stored(page);
    expect(rejected.draft.stageStatus.variables).toBe('failed');
    expect(rejected.draft.variables).toBeUndefined();
    expect(rejected.draft.story.narrative).toBe(text);
    expect(rejected.formal).toBe(before);
    corrected = true;
    await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
    await ready(page);
    const accepted = await stored(page);
    expect(accepted.formal).toBe(before);
    expect(accepted.draft.story.narrative).toBe(text);
    expect(accepted.draft.variables.result.commands[scene ? 1 : 0]).toMatchObject(
      scene ? { changes: { onScene: false } } : { account: 'onlineBalance' },
    );
  });
}

test('正式文本命令映射NPC状态、私人记忆与消费；已启用JSON Mode仍为文本请求，候选不提前结算', async ({ page }) => {
  const before = await seed(page, true, false, '与同事聊天后付了午餐费。', true);
  let calls = 0;
  await page.route('https://variables.mock.invalid/**', async route => {
    calls++; expect(route.request().postDataJSON()).not.toHaveProperty('response_format');
    await route.fulfill({contentType:'application/json',body:response(`<thinking>当前变化整理。</thinking><说明>说明不是执行结果。</说明><命令>
set npc[npc-a].healthText = "略感疲倦"
push npc[npc-a].memories = {"text":"本轮一起吃过午饭","knowledgeKind":"observed","knowledgeSource":"亲历","visibility":"npc_private"}
add economy.cash = -3000
</命令>`)});
  });
  await page.getByRole('button', {name:'生成变量候选',exact:true}).click(); await ready(page);
  const saved = await stored(page); expect(saved.formal).toBe(before); expect(calls).toBe(1);
  expect(saved.draft.variables.result.commands.map((c:{type:string})=>c.type)).toEqual(['UpdateNpc','RecordNpcMemory','SpendFunds']);
  expect(saved.draft.variables.result.commands[1].memory.visibility).toBe('npc_private');
  await expect(page.getByRole('complementary',{name:'主角信息'})).toContainText('100.00 元');
  await page.reload(); await openGameTools(page); await ready(page); expect(calls).toBe(1); expect((await stored(page)).formal).toBe(before);
});
