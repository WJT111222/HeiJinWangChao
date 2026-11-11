import { test, expect } from './helpers/test';
import { seedRoster, rosterGame, openNpcRoster, selectNpc, closeNpcRoster } from './helpers/npcRoster';
import { experiencedMemory, reportedMemory, suspectedMemory, qualityStory, qualityVariables } from '../src/tests/fixtures/npcMemoryQuality';

test('完整人物经历经真实三阶段、原子结算、刷新与撤回保留，只有三次Mock请求', async ({ page }) => {
  await seedRoster(page); const before = await rosterGame(page), calls: string[] = [];
  await page.route('https://summary.mock.invalid/**', async route => {
    const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
    const system = body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content).join('\n');
    if (stage !== 'story') {
      for (const marker of ['人物原始记忆内容质量', '本人表现', '持续影响', '信息完整性高于字数', '不是硬性字数门槛']) expect(system).toContain(marker);
    }
    if (stage === 'story') {
      const content = `<thinking>描写交涉与不同人的认知。</thinking><正文>${qualityStory}</正文><短期记忆>收费暂缓，等待核算。</短期记忆><变量规划>[]</变量规划>`;
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` }); return;
    }
    const contextText = body.messages.find((m: { content: string }) => m.content.startsWith('<GAME_CONTEXT>')).content;
    const context = JSON.parse(contextText.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length));
    const content = stage === 'variables' ? qualityVariables() : JSON.stringify({
      worldCommands: [{ type: 'RecordNpcMemory', commandId: 'offscreen-message', npcId: 'other', expectedRevision: context.BASE_SAVE_REVISION, evidence: '离场人物收到了消息', addToKnownInformation: false, knowledgeKind: 'reported', memory: {
        id: 'other-reported', text: '[转述]' + reportedMemory, knowledgeSource: '林澄发来的消息', visibility: 'npc_private', createdAtGameTime: context.SAVE_STATE.worldClock, sourceTurnIds: [context.TURN_CONTEXT.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'other' }],
      } }], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [],
    });
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
  });
  await page.getByLabel('你的行动', { exact: true }).fill('一起核对交付清单');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await rosterGame(page)).state.turnNumber, { timeout: 20000 }).toBe(before.state.turnNumber + 1);
  const saved = await rosterGame(page);
  expect(saved.state.npc.person.memories.at(-1)).toMatchObject({ text: experiencedMemory, knowledgeKind: 'observed', visibility: 'npc_private' });
  expect(saved.state.npc.special.memories.at(-1)).toMatchObject({ text: '[推测]' + suspectedMemory, knowledgeKind: 'suspected', visibility: 'internal' });
  expect(saved.state.npc.other.memories.at(-1)).toMatchObject({ text: '[转述]' + reportedMemory, knowledgeKind: 'reported', visibility: 'npc_private' });
  expect(saved.state.memories.npcSummaries).toEqual(before.state.memories.npcSummaries);
  expect(saved.state.npc.special.privateProfile).toEqual(before.state.npc.special.privateProfile);
  expect(calls).toEqual(['story', 'variables', 'world']);
  await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  expect((await rosterGame(page)).state).toEqual(saved.state);
  await openNpcRoster(page); const detail = await selectNpc(page, '林澄');
  await detail.getByLabel('搜索人物记忆与总结').fill('交接凭据');
  await expect(detail).toContainText('这次争议没有解决最终费用');
  await expect(detail).toContainText('不能把暂缓收费当成已经免除费用');
  await closeNpcRoster(page);
  await page.getByRole('button', { name: /^撤回（1）$/ }).click();
  await page.getByRole('dialog', { name: '撤回上一回合', exact: true }).getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect.poll(async () => (await rosterGame(page)).state.turnNumber).toBe(before.state.turnNumber);
  const undone = await rosterGame(page);
  expect(undone.state.npc).toEqual(before.state.npc); expect(undone.state.memories).toEqual(before.state.memories);
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('一起核对交付清单');
  expect(calls).toEqual(['story', 'variables', 'world']);
});
