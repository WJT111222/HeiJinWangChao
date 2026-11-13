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

// 两端复用阶段页签；手机在 #122 原生模态 Dialog 中提供两层导航。
const desktopWorkflow = (page: Page) => (page.viewportSize()?.width ?? 0) > 900;
const stageIndex = { story: 0, variables: 1, world: 2 } as const;
export type WorkflowStage = keyof typeof stageIndex;
export async function openStageSwitches(page: Page) {
  await openWorkflow(page);
  const back=page.getByRole('button',{name:'返回三阶段列表',exact:true});
  if(await back.isVisible())await back.click();
}
async function openRailView(page:Page,name:'运行诊断'|'已绑定输入') {
  await openStageSwitches(page);await page.locator('.wf-aux .wf-ri').filter({hasText:name}).click();
}
export async function openWorkflowDiagnostics(page:Page){await openRailView(page,'运行诊断');}
export async function openBoundInput(page:Page){await openRailView(page,'已绑定输入');}
export async function openWorkflowStage(page:Page,stage:WorkflowStage){
  await openStageSwitches(page);await page.locator('.wf-rail .workflow-stages>li').nth(stageIndex[stage]).locator('.wf-ri').click();
}
export async function openStageTab(page:Page,stage:WorkflowStage,tab:'概览'|'候选'|'模型原文'|'叙事规划'|'校验结果'){
  await openWorkflowStage(page,stage);await page.locator('.wf-stage').getByRole('tab',{name:new RegExp(`^${tab}`)}).click();
}
export async function openStageRaw(page:Page,stage:WorkflowStage){await openStageTab(page,stage,'模型原文');return page.locator('.stage-responses');}
export async function openStageCandidates(page:Page,stage:'variables'|'world'){await openStageTab(page,stage,'候选');return page.locator('.wf-stage');}
export async function openCandidateRaw(page:Page,stage:'variables'|'world'){await openStageTab(page,stage,'模型原文');return page.getByRole('region',{name:'模型原文',exact:true});}
export async function openStoryInspection(page:Page){await openStageTab(page,'story','叙事规划');return page.locator('.story-inspection');}
// Candidate is a tab inside the workflow now; return to its first level on phones.
export async function closeStageCandidates(page:Page){if(!desktopWorkflow(page))await openStageSwitches(page);}
export async function closeWorkflowSheet(page:Page){if(!desktopWorkflow(page)&&await page.getByRole('dialog',{name:'三阶段工作流',exact:true}).isVisible())await page.keyboard.press('Escape');}

// Responsive navigation opens the existing directory/profile dialogs, without touching save state.
export async function openWorldArchive(page: Page) {
  await closeWorkflowSheet(page);
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
  await closeWorkflowSheet(page);
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
  await closeWorkflowSheet(page);
  await closeWorldArchive(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
}

export const workflowTrigger = (page: Page) => page.locator('details.workflow-disclosure > summary, .workflow-summary > .workflow-toggle');
export const workflowSummary = (page: Page) => page.locator('details.workflow-disclosure > summary, .workflow-summary');
