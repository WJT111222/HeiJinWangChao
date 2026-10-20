import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const result = {
  worldCommands: [
    {
      type: 'UpdateNpc',
      commandId: 'world-action',
      npcId: 'npc-a',
      expectedRevision: 0,
      changes: { healthText: '稍感疲倦' },
      evidence: JSON.stringify({
        version: 1,
        kind: 'derived',
        at: '2026-10-18T08:05:00+08:00',
        sources: ['goal:npc-a:0'],
        fact: '同事整理了诊室。',
        rationale: '依据独立工作目标，在十分钟内整理器材。',
      }),
    },
  ],
  taskCommands: [],
  eventCommands: [],
  futureEvents: [],
  visibleHooks: [{ text: '尚未发布的诊室线索', revealAfter: '2026-10-18T08:00:00+08:00' }],
  timelineCandidates: [],
  unresolved: ['内部经营变化不结算'],
};
const response = (value: unknown = result) =>
  JSON.stringify({
    choices: [
      {
        message: { content: typeof value === 'string' ? value : JSON.stringify(value) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
  });
async function seed(page: Page, variables = true, disabled = false) {
  await page.goto('/');
  const before = await page.evaluate(
    async ({ variables, disabled }) => {
      const repoPath = '/src/services/storage/saveRepository.ts',
        fixturePath = '/src/tests/fixtures/world.ts',
        draftPath = '/src/domain/drafts.ts',
        configPath = '/src/services/ai/configuration.ts',
        vaultPath = '/src/services/ai/credentials.ts',
        settingsPath = '/src/ui/settings/model.ts';
      const { SaveRepository } = await import(repoPath),
        { worldState, worldDraft } = await import(fixturePath),
        { createTurnDraft, rerollStory } = await import(draftPath),
        { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath),
        { CredentialVault } = await import(vaultPath),
        { defaultSettings, settingsKey } = await import(settingsPath);
      const settings = defaultSettings();
      settings.prompts.minNarrativeChars = 10;
      settings.runtime.useVariableStage = !disabled;
      settings.runtime.useWorldStage = !disabled;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const config = defaultAiConfig(),
        channel = newChannel();
      channel.baseUrl = 'https://world.mock.invalid/v1';
      channel.defaultModel = 'world-browser-model';
      config.channels = [channel];
      config.routes.story = { channelId: channel.id, modelId: 'story-browser-model' };
      config.routes.world = { mode: 'independent', channelId: channel.id, modelId: '' };
      saveAiConfig(localStorage, config);
      new CredentialVault(sessionStorage, localStorage).set(
        channel.id,
        'mock-world-browser-secret',
      );
      const repo = await SaveRepository.open(),
        state = await repo.create({ ...worldState(), title: '世界阶段测试（隔离）' }),
        initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '', !disabled, !disabled);
      await repo.saveDraft(initial, null);
      const d = worldDraft(variables),
        ready = rerollStory(initial, d.story);
      await repo.saveDraft(ready, 0);
      if (variables) await repo.saveDraft({ ...d, draftRevision: 2 }, 1);
      repo.close();
      return JSON.stringify(state);
    },
    { variables, disabled },
  );
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.getByRole('heading', { name: '林舟', exact: true })).toBeVisible();
  return before;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path),
      repo = await SaveRepository.open();
    try {
      return {
        formal: JSON.stringify(await repo.load('save-a')),
        draft: await repo.loadDraft('save-a'),
      };
    } finally {
      repo.close();
    }
  });
}
async function ready(page: Page) {
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText(
    '世界已完成 · 候选未正式结算',
  );
}

test('世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变', async ({ page }, info) => {
  const before = await seed(page),
    bodies: Record<string, unknown>[] = [];
  await page.route('https://world.mock.invalid/**', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', body: response() });
  });
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await page.getByRole('button', { name: '生成世界候选', exact: true }).click();
  await ready(page);
  const first = await stored(page);
  expect(first.formal).toBe(before);
  expect(first.draft.world.validation).toBe('validated');
  expect(first.draft.world.basedOnVariableRevision).toBe(1);
  expect(first.draft.useVariableStage).toBe(false);
  expect(bodies[0].model).toBe('world-browser-model');
  expect(JSON.stringify(bodies[0])).toContain('WORLD_SOURCES');
  await expect(page.locator('main')).not.toContainText('尚未发布的诊室线索');
  await page.getByRole('button', { name: '查看世界候选（未结算）', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '世界候选 · 未正式结算', exact: true });
  await expect(dialog).not.toContainText('尚未发布的诊室线索');
  await dialog.getByRole('button', { name: '主动查看完整世界候选', exact: true }).click();
  await expect(dialog.getByLabel('完整世界候选')).toContainText('尚未发布的诊室线索');
  await expect(dialog).not.toContainText('mock-world-browser-secret');
  await page.screenshot({ path: info.outputPath('world-candidates.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新生成世界候选', exact: true }).click();
  await ready(page);
  const second = await stored(page);
  expect(second.draft.world.candidateRevision).toBeGreaterThan(first.draft.world.candidateRevision);
  expect(second.draft.story).toEqual(first.draft.story);
  expect(second.draft.variables).toEqual(first.draft.variables);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('world');
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('regular');
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const inspection = page.getByRole('region', { name: '上下文与统计' });
  await expect(inspection).toContainText('world-browser-model');
  await expect(inspection).toContainText('stages.regular.world');
  await expect(inspection).toContainText('110');
  await expect(inspection).not.toContainText('mock-world-browser-secret');
  await page.keyboard.press('Escape');
  await page.reload();
  await ready(page);
  expect((await stored(page)).formal).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文', async ({ page }) => {
  const before = await seed(page, false, true),
    initial = await stored(page);
  await expect(page.getByRole('button', { name: '启用并补算世界', exact: true })).toBeDisabled();
  await page.getByLabel('动态世界', { exact: true }).check();
  const planned = {
    ...result,
    worldCommands: [
      {
        ...result.worldCommands[0],
        changes: {},
        activeGoals: ['整理明日排班'],
        evidence: JSON.stringify({
          version: 1,
          kind: 'planned',
          at: '2026-10-18T08:00:00+08:00',
          sources: ['goal:npc-a:0'],
          fact: '同事计划整理明日排班。',
          rationale: '既有工作目标的后续计划，不表示已执行。',
        }),
      },
    ],
  };
  await page.route('https://world.mock.invalid/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: response(planned) }),
  );
  await page.getByRole('button', { name: '启用并补算世界', exact: true }).click();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText(
    '世界预览 · 变量依赖未完成',
  );
  const saved = await stored(page);
  expect(saved.formal).toBe(before);
  expect(saved.draft.world.validation).toBe('preview');
  expect(saved.draft.story).toEqual(initial.draft.story);
  expect(saved.draft.variables).toBeUndefined();
});

test('错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行', async ({ page }) => {
  const before = await seed(page);
  let mode: 'bad' | 'slow' | 'good' = 'bad',
    count = 0;
  await page.route('https://world.mock.invalid/**', async (route) => {
    count++;
    const current = mode;
    if (current === 'slow') await new Promise((resolve) => setTimeout(resolve, 1200));
    await route
      .fulfill({
        contentType: 'application/json',
        body: response(current === 'bad' ? '{bad-json' : result),
      })
      .catch(() => undefined);
  });
  await page.getByRole('button', { name: '生成世界候选', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await stored(page)).draft.world).toBeUndefined();
  mode = 'slow';
  await page
    .getByRole('button', { name: '生成世界候选', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => count).toBe(2);
  await expect(page.getByRole('button', { name: '重新 Roll', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重新生成变量候选', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消世界生成', exact: true }).click();
  mode = 'good';
  await page.getByRole('button', { name: '生成世界候选', exact: true }).click();
  await ready(page);
  expect((await stored(page)).formal).toBe(before);
  expect(count).toBe(3);
});

test('二轮约束：计划地点、事件预结案和 NPC 双任务拒绝，合法预计时间可重试保存', async ({
  page,
}) => {
  const before = await seed(page);
  let mode: 'planned-location' | 'premature-event' | 'npc-quota' | 'valid-event' =
    'planned-location';
  await page.route('https://world.mock.invalid/**', async (route) => {
    const e = {
      id: 'event-a',
      title: '诊室器材清点',
      status: 'scheduled',
      startAt: '2026-10-18T09:00:00+08:00',
      estimatedEndAt: '2026-10-18T10:30:00+08:00',
      actorRefs: [{ kind: 'npc', id: 'npc-a' }],
      linkedTaskIds: [],
      prerequisites: [],
      blockers: [],
      visibility: 'hidden',
      impact: 'minor',
      sourceTurnIds: ['turn-a'],
    };
    const evidence = JSON.stringify({
      version: 1,
      kind: 'planned',
      at: '2026-10-18T08:05:00+08:00',
      sources: ['goal:npc-a:0'],
      fact: '同事计划整理诊室。',
      rationale: '安排后续工作并估算时间，不表示已经结束。',
    });
    const value = {
      ...result,
      worldCommands: [] as unknown[],
      taskCommands: [] as unknown[],
      eventCommands: [] as unknown[],
      futureEvents: [] as unknown[],
    };
    if (mode === 'planned-location')
      value.worldCommands = [
        {
          type: 'CreateLocation',
          commandId: 'loc',
          evidence,
          location: { id: 'warehouse', name: '计划中的仓库', parentId: 'chongqing' },
        },
      ];
    else if (mode === 'npc-quota')
      value.taskCommands = ['a', 'b'].map((id) => ({
        type: 'SaveTask',
        commandId: `job-${id}`,
        evidence,
        task: {
          id,
          goal: `清点工作 ${id}`,
          actorRef: { kind: 'npc', id: 'npc-a' },
          status: 'planned',
          startAt: '2026-10-18T08:05:00+08:00',
          dueAt: '2026-10-18T09:00:00+08:00',
          prerequisites: [],
          blockers: [],
        },
      }));
    else {
      const event = mode === 'premature-event' ? { ...e, resolutionText: '已取得成功' } : e;
      value.eventCommands = [{ type: 'SaveEvent', commandId: 'event', evidence, event }];
      value.futureEvents = [event];
    }
    await route.fulfill({ contentType: 'application/json', body: response(value) });
  });
  for (const attempt of ['planned-location', 'premature-event', 'npc-quota'] as const) {
    mode = attempt;
    await page.getByRole('button', { name: '生成世界候选', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    if (attempt === 'npc-quota')
      await expect(page.getByRole('alert')).toContainText('NPC 已有未终结后台任务');
    const rejected = await stored(page);
    expect(rejected.draft.world).toBeUndefined();
    expect(rejected.formal).toBe(before);
  }
  mode = 'valid-event';
  await page.getByRole('button', { name: '生成世界候选', exact: true }).click();
  await ready(page);
  const saved = await stored(page);
  expect(saved.formal).toBe(before);
  expect(saved.draft.world.result.futureEvents[0]).toMatchObject({
    status: 'scheduled',
    estimatedEndAt: '2026-10-18T10:30:00+08:00',
  });
  expect(saved.draft.world.result.futureEvents[0].resolvedAt).toBeUndefined();
  expect(saved.draft.world.result.futureEvents[0].resolutionText).toBeUndefined();
});
