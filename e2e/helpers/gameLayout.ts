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

// 三阶段详情：PC（>900px）为左侧阶段导航 + 右侧分页；手机为底部抽屉，第一层阶段列表、第二层同一套分页详情。
// 两种布局共用同一组件和以下 helper；手机进入第二层后，再选其他阶段需先“‹ 三阶段”回到第一层。
const stageIndex = { story: 0, variables: 1, world: 2 } as const;
export type WorkflowStage = keyof typeof stageIndex;

async function backToStageList(page: Page) {
  const back = page.locator('.wf-sheet .wf-hd .wf-back');
  if (await back.isVisible()) await back.click();
}

async function openRailView(page: Page, name: '运行诊断' | '已绑定输入') {
  await openWorkflow(page);
  await backToStageList(page);
  await page.locator('.wf-aux .wf-ri').filter({ hasText: name }).click();
}

export async function openWorkflowDiagnostics(page: Page) {
  await openRailView(page, '运行诊断');
}

// 只读查看本回合已绑定输入。
export async function openBoundInput(page: Page) {
  await openRailView(page, '已绑定输入');
}

// 阶段开关在 PC 左侧导航与手机抽屉第一层；手机在第二层时先返回列表。
export async function openStageSwitches(page: Page) {
  await openWorkflow(page);
  await backToStageList(page);
}

// 操作某阶段按钮前选中该阶段（PC 左侧导航；手机抽屉第一层的阶段行）。
export async function openWorkflowStage(page: Page, stage: WorkflowStage) {
  await openWorkflow(page);
  await backToStageList(page);
  await page.locator('.wf-rail .workflow-stages > li').nth(stageIndex[stage]).locator('.wf-ri').click();
}

export async function openStageTab(page: Page, stage: WorkflowStage, tab: '概览' | '候选' | '模型原文' | '叙事规划' | '校验结果') {
  await openWorkflowStage(page, stage);
  await page.locator('.wf-stage').getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}

// 阶段模型原文：该阶段“模型原文”页。返回含原文和错误说明的容器。
export async function openStageRaw(page: Page, stage: WorkflowStage) {
  await openStageTab(page, stage, '模型原文');
  return page.locator('.stage-responses');
}

// 变量/世界候选：该阶段“候选”页。返回可查找“主动查看完整…候选”的容器。
export async function openStageCandidates(page: Page, stage: 'variables' | 'world') {
  await openStageTab(page, stage, '候选');
  return page.locator('.wf-stage');
}

// 候选对应的模型原文区域（region“模型原文”）。
export async function openCandidateRaw(page: Page, stage: 'variables' | 'world') {
  await openStageTab(page, stage, '模型原文');
  return page.getByRole('region', { name: '模型原文', exact: true });
}

// 正文叙事规划与原生输出：正文阶段“叙事规划”页（切到此页即主动查看）。
export async function openStoryInspection(page: Page) {
  await openStageTab(page, 'story', '叙事规划');
  return page.locator('.story-inspection');
}

// 候选已在面板内（不再是弹窗），保留此函数以兼容已有用例，无需关闭。
export async function closeStageCandidates(page: Page) {
  void page;
}

// 手机抽屉上方的暗区覆盖人物状态与顶栏；点它们之前先收起抽屉（PC 浮层不遮挡这些区域）。
export async function closeWorkflowSheet(page: Page) {
  if (!(await page.locator('.wf-sheet').isVisible())) return;
  await workflowTrigger(page).click();
  await expect(page.locator('.wf-sheet')).toBeHidden();
}

// Responsive navigation opens the existing directory/profile dialogs, without touching save state.
export async function openWorldArchive(page: Page) {
  const opener = page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '世界资料', exact: true });
  if (await opener.isVisible() && !await page.getByRole('dialog', { name: '世界资料', exact: true }).isVisible()) await opener.click();
}
export async function openProfile(page: Page) {
  await closeWorkflowSheet(page);
  const compact = page.getByRole('button', { name: '展开人物状态', exact: true });
  if (await compact.isVisible()) await compact.click();
  else await page.getByRole('button', { name: '人物档案', exact: true }).click();
}
export async function goHome(page: Page) {
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await page.keyboard.press('Escape');
  await closeWorkflowSheet(page);
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
