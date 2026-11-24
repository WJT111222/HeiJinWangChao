import { expect, test } from './helpers/test';
import { openStageRaw, openWorkflowDiagnostics } from './helpers/gameLayout';
import { seedSummary, summaryPage, summaryState, requestTask } from './helpers/memorySummary';
import type { FeedbackReport } from '../src/services/feedback/contract';

test('NPC 总结按请求关联原文，持久诊断与匿名反馈可分别查看', async ({ page, context, isMobile }, info) => {
  const modelCalls: string[] = [], uploads: FeedbackReport[] = [];
  const firstContent = JSON.stringify({ summaries: [], unresolved: [], contradictions: [] });
  const secondContent = '{第二人物的合成未完成总结';
  const receipt = '91fa45a1-2f76-4e31-9af7-b353519154aa';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://**', route => route.abort());
  await page.route('https://summary.mock.invalid/**', route => {
    const task = requestTask(route.request().postDataJSON());
    modelCalls.push(String(task.npcId));
    const first = task.npcId === 'npc-a';
    return route.fulfill({ json: { choices: [{
      message: { content: first ? firstContent : secondContent,
        reasoning_content: first ? '第一人物公开思考 mock-summary-secret save-a' : '第二人物公开思考' },
      finish_reason: 'stop',
    }] } });
  });
  await page.route('**/api/feedback', route => {
    uploads.push(route.request().postDataJSON().feedback as FeedbackReport);
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ status: 201, json: { id: receipt } });
  });
  await seedSummary(page, { count: 0, npcCount: 20, secondNpc: true });
  const before = await summaryState(page);
  const popup = page.getByRole('dialog', { name: 'NPC 短期 → 中期总结待确认', exact: true });
  await expect(popup).toBeVisible();
  await popup.getByText('查看总结诊断与模型原文', { exact: true }).click();
  await expect(popup.getByText('预计分组 1 · 实际分组 0')).toBeVisible();
  await expect(popup.getByRole('textbox', { name: '记忆总结模型原文' })).toHaveValue(firstContent);
  await popup.screenshot({ path: info.outputPath('memory-popup.png') });
  await popup.getByRole('button', { name: isMobile ? '关闭' : '关闭资料界面', exact: true }).click();

  const settings = await summaryPage(page);
  await settings.getByLabel('总结目标 NPC').selectOption('npc-b');
  await settings.getByRole('button', { name: '立即总结 · NPC 短期 → 中期', exact: true }).click();
  await expect(popup).toBeVisible();
  await expect(popup.getByText('第二人物', { exact: true })).toBeVisible();
  await popup.getByText('查看总结诊断与模型原文', { exact: true }).click();
  await expect(popup.getByRole('textbox', { name: '记忆总结模型原文' })).toHaveValue(secondContent);
  await popup.getByRole('button', { name: isMobile ? '关闭' : '关闭资料界面', exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByText('查看总结诊断与模型原文', { exact: true }).click();
  await expect(settings.getByText(/校验总结 · JSON 解析失败/)).toBeVisible();
  await settings.getByRole('button', { name: '关闭资料界面' }).click();

  const raw = await openStageRaw(page, 'story');
  await raw.getByText('记忆总结模型原文 · 2 次', { exact: true }).click();
  const choices = raw.getByText('NPC 短期 → 中期 · 总结未完成', { exact: true });
  await expect(choices).toHaveCount(2);
  await choices.nth(1).click();
  await raw.getByText('供应商公开思考', { exact: true }).click();
  await expect(raw.getByRole('textbox', { name: '记忆总结公开思考' })).toHaveValue('第一人物公开思考 [密钥已隐藏] save-a');
  await raw.getByRole('button', { name: '复制模型原文', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstContent);
  await raw.getByRole('button', { name: '复制技术诊断', exact: true }).click();
  await expect(raw.getByRole('status')).toHaveText('已复制技术诊断');
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied).toMatchObject({ task: 'npc', code: 'MEMORY_OUTPUT', reason: 'missing_groups', fieldPath: 'summaries',
    expectedGroups: 1, actualGroups: 0, protocol: 'openai', model: 'memory', httpStatus: 200 });
  await raw.screenshot({ path: info.outputPath('memory-raw.png') });

  await openWorkflowDiagnostics(page);
  let scope = page.locator('body');
  if (isMobile) {
    await page.getByRole('button', { name: '重试与变更详情', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
    await dialog.getByRole('tab', { name: /^运行日志/ }).click();
    scope = dialog;
  }
  const reportButton = scope.getByRole('button', { name: '上报错误', exact: true });
  const form = page.getByRole('dialog', { name: '上报错误', exact: true });
  await expect(scope.getByText('记忆总结 · NPC 短期 → 中期', { exact: true })).toHaveCount(2);
  for (const attachment of ['', '附带最近保留的报错环节模型原文', '附带最近保留的报错环节公开思考']) {
    await reportButton.click();
    const content = form.getByRole('checkbox', { name: /模型原文/ });
    const thoughts = form.getByRole('checkbox', { name: /公开思考/ });
    await expect(content).not.toBeChecked();
    await expect(thoughts).not.toBeChecked();
    if (attachment) await form.getByRole('checkbox', { name: attachment }).check();
    if (attachment === '附带最近保留的报错环节模型原文') {
      await form.getByText('预览上传内容', { exact: true }).click();
      await form.screenshot({ path: info.outputPath('memory-feedback.png') });
    }
    await form.getByRole('button', { name: '提交错误报告' }).click();
    await expect(form.getByRole('status')).toContainText(receipt);
    await form.getByRole('button', { name: '关闭错误上报' }).click();
  }
  expect(uploads).toHaveLength(3);
  for (const payload of uploads) {
    expect(payload.errors.map(log => [log.ref, log.stage, log.memory?.task, log.memory?.reason])).toEqual(
      [[1, 'memory', 'npc', 'missing_groups'], [2, 'memory', 'npc', 'invalid_json']]);
    expect(JSON.stringify(payload)).not.toMatch(/mock-summary-secret|save-a|npc-a|npc-b|memorySaveRef|responseId|retryId/);
  }
  expect(uploads[0]).not.toHaveProperty('attachments');
  expect(uploads[1].attachments).toEqual([{ errorRef: 2, content: secondContent }, { errorRef: 1, content: firstContent }]);
  expect(uploads[2].attachments).toEqual([{ errorRef: 2, reasoning: '第二人物公开思考' },
    { errorRef: 1, reasoning: '第一人物公开思考 [密钥已隐藏] [本地标识已隐藏]' }]);
  await info.attach('memory-feedback-requests.json', { body: JSON.stringify(uploads, null, 2), contentType: 'application/json' });

  await page.evaluate(async () => {
    const path = '/src/services/ai/stageResponses.ts';
    (await import(path)).stageResponses.clear();
  });
  await reportButton.click();
  await form.getByRole('checkbox', { name: /模型原文/ }).check();
  await expect(form).toContainText('没有可附带的对应内容');
  await form.getByRole('button', { name: '提交错误报告' }).click();
  await expect(form.getByRole('status')).toContainText(receipt);
  expect(uploads[3]).not.toHaveProperty('attachments');
  await page.reload();
  await expect(popup).toBeVisible();
  await popup.getByText('查看总结诊断与模型原文', { exact: true }).click();
  await expect(popup).toContainText('本页没有保留此请求的模型原文');
  await expect(popup).toContainText('NPC 认知分组缺失');
  expect(await summaryState(page)).toEqual(before);
  expect(modelCalls).toEqual(['npc-a', 'npc-b']);
});
