import { expect } from '@playwright/test';
import { openLibrary } from './home';
import type { Page } from '@playwright/test';

// 原有高级工作流/资料测试显式打开折叠区，继续验证原操作；默认折叠由独立布局测试覆盖。
export async function openGameTools(page: Page, entering = false) {
  if (entering) await expect.poll(() => new URL(page.url()).hash.startsWith('#game/')).toBe(true);
  if (!new URL(page.url()).hash.startsWith('#game/')) return;
  await expect(page.locator('.game-layout')).toBeVisible();
  await closeWorldArchive(page);
  await openWorkflow(page);
}

// 操作高级控件前显式展开；不调用生成/恢复，也不修改业务状态。
export async function openWorkflow(page: Page) {
  const disclosure = page.locator('.workflow-disclosure');
  await expect(disclosure).toBeAttached();
  if (!(await disclosure.evaluate(element => element.hasAttribute('open'))))
    await workflowTrigger(page).click();
}

// PC（>900px）三阶段详情为左侧阶段导航 + 右侧分页；移动端保留原折叠卡片。
const desktopWorkflow = (page: Page) => (page.viewportSize()?.width ?? 0) > 900;
const stageIndex = { story: 0, variables: 1, world: 2 } as const;
const rawLabels = { story: '正文', variables: '变量', world: '动态世界' } as const;
export type WorkflowStage = keyof typeof stageIndex;

async function openRailView(page: Page, name: '运行诊断' | '已绑定输入') {
  await openWorkflow(page);
  await page.locator('.wf-aux .wf-ri').filter({ hasText: name }).click();
}

export async function openWorkflowDiagnostics(page: Page) {
  if (desktopWorkflow(page)) return openRailView(page, '运行诊断');
  await openWorkflow(page);
  const details = page.locator('.workflow-diagnostics');
  if (!(await details.evaluate(element => element.hasAttribute('open'))))
    await details.locator(':scope > summary').click();
}

// 只读查看本回合已绑定输入；PC 为左侧“已绑定输入”视图，移动端展开原折叠块。
export async function openBoundInput(page: Page) {
  if (desktopWorkflow(page)) return openRailView(page, '已绑定输入');
  await openWorkflow(page);
  const details = page.locator('.bound-input');
  if (!(await details.evaluate(element => element.hasAttribute('open'))))
    await details.locator(':scope > summary').click();
}

// 操作某阶段按钮前选中该阶段；移动端三张卡片同时可见，只需展开工作流。
export async function openWorkflowStage(page: Page, stage: WorkflowStage) {
  await openWorkflow(page);
  if (!desktopWorkflow(page)) return;
  await page.locator('.wf-rail .workflow-stages > li').nth(stageIndex[stage]).locator('.wf-ri').click();
}

export async function openStageTab(page: Page, stage: WorkflowStage, tab: '概览' | '候选' | '模型原文' | '叙事规划' | '校验结果') {
  await openWorkflowStage(page, stage);
  await page.locator('.wf-stage').getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}

// 阶段模型原文：PC 为该阶段“模型原文”页；移动端为诊断区内的三阶段原文折叠块。返回含原文和错误说明的容器。
export async function openStageRaw(page: Page, stage: WorkflowStage) {
  if (desktopWorkflow(page)) {
    await openStageTab(page, stage, '模型原文');
    return page.locator('.stage-responses');
  }
  await openWorkflowDiagnostics(page);
  const panel = page.locator('.stage-responses');
  if (!(await panel.evaluate(element => element.hasAttribute('open')))) await panel.locator(':scope > summary').click();
  const item = panel.locator(':scope > details').filter({ has: page.locator(':scope > summary', { hasText: `${rawLabels[stage]}模型原文` }) });
  if (!(await item.evaluate(element => element.hasAttribute('open')))) await item.locator(':scope > summary').click();
  return panel;
}

// 变量/世界候选：PC 为该阶段“候选”页，移动端为原只读弹窗。返回可查找“主动查看完整…候选”的容器。
export async function openStageCandidates(page: Page, stage: 'variables' | 'world') {
  const name = stage === 'variables' ? '变量' : '世界';
  if (desktopWorkflow(page)) {
    await openStageTab(page, stage, '候选');
    return page.locator('.wf-stage');
  }
  const dialog = page.getByRole('dialog', { name: `${name}候选 · 未正式结算`, exact: true });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: `查看${name}候选（未结算）`, exact: true }).click();
  return dialog;
}

// 候选对应的模型原文区域（region“模型原文”）：PC 在“模型原文”页，移动端在候选弹窗内。
export async function openCandidateRaw(page: Page, stage: 'variables' | 'world') {
  if (desktopWorkflow(page)) {
    await openStageTab(page, stage, '模型原文');
    return page.getByRole('region', { name: '模型原文', exact: true });
  }
  return (await openStageCandidates(page, stage)).getByRole('region', { name: '模型原文', exact: true });
}

// 正文叙事规划与原生输出：PC 为正文阶段“叙事规划”页（直接展开），移动端在诊断区内主动展开。
export async function openStoryInspection(page: Page) {
  if (desktopWorkflow(page)) await openStageTab(page, 'story', '叙事规划');
  else {
    await openWorkflowDiagnostics(page);
    const details = page.locator('.story-inspection');
    if (!(await details.evaluate(element => element.hasAttribute('open')))) await details.locator(':scope > summary').click();
  }
  return page.locator('.story-inspection');
}

// 移动端关闭候选弹窗；PC 候选在面板内，无需关闭。
export async function closeStageCandidates(page: Page) {
  if (!desktopWorkflow(page)) await page.keyboard.press('Escape');
}

// Responsive navigation opens the existing directory/profile dialogs, without touching save state.
export async function openWorldArchive(page: Page) {
  const opener = page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '世界资料', exact: true });
  if (await opener.isVisible() && !await page.getByRole('dialog', { name: '世界资料', exact: true }).isVisible()) await opener.click();
}
export async function openProfile(page: Page) {
  const compact = page.getByRole('button', { name: '展开人物状态', exact: true });
  if (await compact.isVisible()) await compact.click();
  else await page.getByRole('button', { name: '人物档案', exact: true }).click();
}
export async function goHome(page: Page) {
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await page.keyboard.press('Escape');
  const desktopHome = page.getByRole('navigation', { name: '系统操作' }).getByRole('button', { name: '返回首页', exact: true });
  if (await desktopHome.isVisible()) { await desktopHome.click(); await openLibrary(page); return; }
  const menu = page.getByRole('button', { name: '打开游戏菜单', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click(); await openLibrary(page);
}

async function closeWorldArchive(page: Page) {
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await directory.getByRole('button', { name: '关闭资料界面', exact: true }).click();
}
export async function openSettings(page: Page) {
  await closeWorldArchive(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
}

export const workflowTrigger = (page: Page) => page.locator('details.workflow-disclosure > summary, .workflow-summary > .workflow-toggle');
export const workflowSummary = (page: Page) => page.locator('details.workflow-disclosure > summary, .workflow-summary');
