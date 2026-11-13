import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// AI 连接设置（重设计）的测试操作。电脑端渠道列表与编辑器并排；手机端点开渠道进入编辑，返回后看到各阶段模型。
type Scope = Page | Locator;
const pageOf = (scope: Scope): Page => ('page' in scope && typeof scope.page === 'function' ? scope.page() : scope) as Page;

export async function openAiSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 连接', exact: true }).click();
  return settings;
}
/** 设置已打开时确保停在「AI 连接」分类（手机端可能停在分类菜单）。 */
export async function aiTab(page: Page) {
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(settings).toBeVisible();
  const entry = settings.getByRole('button', { name: 'AI 连接', exact: true });
  if (await entry.isVisible().catch(() => false)) await entry.click();
  return settings;
}
/** 手机端如果正在编辑渠道，先返回渠道列表（各阶段模型在列表页）。 */
export async function backToList(scope: Scope) {
  const back = scope.getByRole('button', { name: '‹ 返回渠道列表', exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
}
export async function openChannel(scope: Scope, name: string) {
  await backToList(scope);
  await scope.getByRole('button', { name: `编辑渠道：${name}`, exact: true }).click();
}
export interface ChannelInput { preset?: string; name?: string; url?: string; format?: string; key?: string }
/** 添加渠道：选服务商 → 地址 → 密钥。preset 为服务商按钮的主名称，如「OpenAI 兼容」「Gemini」。 */
export async function addChannel(scope: Scope, input: ChannelInput = {}) {
  await backToList(scope);
  await scope.getByRole('button', { name: '＋ 添加渠道', exact: true }).click();
  await choosePreset(scope, input.preset ?? 'OpenAI 兼容');
  if (input.name !== undefined) await scope.getByLabel('渠道名称', { exact: true }).fill(input.name);
  if (input.url !== undefined) await setUrl(scope, input.url);
  if (input.format) await chooseText(scope, '接口格式', input.format);
  if (input.key !== undefined) await scope.getByLabel('API 密钥', { exact: true }).fill(input.key);
}
export async function choosePreset(scope: Scope, preset: string) {
  await scope.getByRole('group', { name: '服务商', exact: true }).getByRole('button', { name: preset, exact: true }).click();
}
export async function setUrl(scope: Scope, url: string) {
  const field = scope.getByLabel('服务地址', { exact: true });
  if (await field.getAttribute('readonly') !== null) await scope.getByRole('button', { name: '需要改地址？', exact: true }).click();
  await field.fill(url);
}
/** 选择下拉项（按显示文字）。 */
export async function chooseText(scope: Scope, label: string, text: string | RegExp) {
  const page = pageOf(scope);
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: text }).first().click();
}
export async function follow(scope: Scope, stage: string, value: boolean) {
  await backToList(scope);
  await scope.getByRole('group', { name: `${stage}模型来源`, exact: true }).getByRole('button', { name: value ? '跟随正文' : '单独指定', exact: true }).click();
}
/** 设置某个阶段：选渠道，再手动填写或从列表选模型。 */
export async function stageModel(scope: Scope, stage: string, channel: string, model: string, from: 'list' | 'manual' = 'manual') {
  await backToList(scope);
  if (stage !== '正文生成') {
    const independent = scope.getByRole('group', { name: `${stage}模型来源`, exact: true }).getByRole('button', { name: '单独指定', exact: true });
    if (await independent.getAttribute('aria-pressed') !== 'true') await independent.click();
  }
  const channelSelect = scope.getByRole('combobox', { name: `${stage}渠道`, exact: true });
  if ((await channelSelect.textContent())?.trim() !== channel) {
    await chooseText(scope, `${stage}渠道`, channel);
  }
  if (from === 'list') await chooseText(scope, `${stage}模型`, model);
  else {
    const input = scope.getByLabel(`${stage}模型 ID`, { exact: true });
    if (!(await input.isVisible().catch(() => false))) await scope.getByRole('button', { name: `列表里没有？手动填写${stage}模型 ID`, exact: true }).click();
    await input.fill(model);
  }
}
export async function saveAi(scope: Scope) {
  await scope.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(scope.locator('.ai-save-bar').getByRole('status')).toContainText('已保存');
}
export async function testReply(scope: Scope) {
  await scope.getByRole('button', { name: '测试回复（可能产生少量费用）', exact: true }).click();
}
