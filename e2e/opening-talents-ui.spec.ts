import { test, expect } from './helpers/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { talentDefinitions } from '../src/domain/protagonist/talents';
import { showCreationReview, mobileCreation } from './helpers/creation';

const evidence = process.env.TALENT_UI_EVIDENCE ?? 'test-results/opening-talents-ui';
const picker = (page: Page) => page.getByRole('group', { name: '开局天赋（可选）', exact: true });
const choice = (page: Page, name: string) => picker(page).getByRole('radio', { name, exact: true });
const none = (page: Page) => picker(page).getByRole('radio', { name: /^不选择天赋/ });
const profile = (page: Page) => page.getByRole('region', { name: '开局天赋', exact: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-16T04:00:00Z'));
  // Block every model POST, including accidental requests to a local mock address.
  await page.route('**/*', route => route.request().method() === 'POST' || !['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) || route.request().url().endsWith('/api/announcement') ? route.abort() : route.continue());
});
function noModelCalls(page: Page) {
  const calls: string[] = []; page.on('request', request => { if (request.method() === 'POST') calls.push(request.url()); });
  return () => expect(calls).toEqual([]);
}
async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(evidence, { recursive: true });
  await page.evaluate(() => document.fonts.ready); await page.mouse.move(0, 0);
  const path = resolve(evidence, `${info.project.name}-${name}.png`);
  await page.screenshot({ path, animations: 'disabled', scale: 'css' }); await info.attach(name, { path, contentType: 'image/png' });
}
async function frameCard(target: Locator) {
  await target.evaluate(element => {
    const scroller = element.closest<HTMLElement>('.creation-card, .ar-body, .modal-body');
    if (scroller) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  });
}
async function seedCreation(page: Page, step = 2) {
  await page.goto('/');
  await page.evaluate(async step => {
    const path = '/src/ui/creation/model.ts', { newCreation, creationKey } = await import(path), form = newCreation();
    form.saveId = 'talent-ui-save'; form.step = step;
    form.person = { name: '林岚', age: '29', gender: '女性', appearance: '旧外貌。', personality: '审慎。' };
    form.customProfession = '旧籍修复师'; form.professionDescription = '修补旧籍，保存社区资料。';
    form.professionLongTermImpact = '与社区图书馆保持联系。'; form.skills = '修补\n沟通'; form.skillsSource = 'manual';
    form.background = '原有背景\n第二行'; form.hasCompanion = true;
    form.companion = { name: '许宁', age: '28', identity: '同事', appearance: '短发', personality: '直率', skills: '排版', background: '原有经历', relationship: '老朋友' };
    localStorage.setItem(creationKey, JSON.stringify(form));
  }, step);
  await page.goto('/#create'); await page.reload(); await expect(page.locator('.creation-page')).toBeVisible();
}
const draft = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.creation.v1')!));
async function step(page: Page, label: string) {
  await page.getByRole('navigation', { name: '角色创建步骤' }).getByRole('button', { name: new RegExp(`${label}$`) }).click();
}
async function archive(page: Page) {
  if (mobileCreation(page)) {
    await page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '人物', exact: true }).click();
    await page.getByRole('dialog', { name: '此时此地', exact: true }).getByRole('button', { name: '人物档案', exact: true }).click();
  } else await page.getByRole('button', { name: '人物档案', exact: true }).click();
  return page.getByRole('dialog', { name: '人物档案', exact: true });
}
async function raw(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.exportRaw(location.hash.slice(6)); } finally { repo.close(); }
  });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
/** These new cards have an opaque solid background. Refuse to invent a ratio
 * if a future theme introduces transparency, a gradient or foreground alpha. */
async function contrast(target: Locator) {
  return target.evaluate(element => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const foreground = rgb(getComputedStyle(element).color);
    if ((foreground[3] ?? 1) !== 1) throw new Error('Non-opaque foreground needs a paint probe');
    let background: number[] | undefined;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (Number(style.opacity) !== 1 || style.filter !== 'none') throw new Error('Unexpected compositing');
      if (background) continue;
      const color = rgb(style.backgroundColor), alpha = color[3] ?? 1;
      if (style.backgroundImage !== 'none' || (alpha !== 0 && alpha !== 1)) throw new Error('Background requires a paint probe');
      if (alpha === 1) background = color;
    }
    if (!background) throw new Error('No opaque card background');
    const light = (color: number[]) => color.slice(0, 3).reduce((sum, value, i) => { const n = value / 255; return sum + (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i]; }, 0);
    const a = light(foreground), b = light(background);
    return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
}

test('八张正式全文卡片、原生单选键盘、取消与刷新；没有额外请求', async ({ page }, info) => {
  const unchangedRequests = noModelCalls(page); await seedCreation(page); const before = await draft(page);
  await expect(picker(page).getByRole('radio')).toHaveCount(9); await expect(none(page)).toBeChecked();
  for (const definition of talentDefinitions) {
    const card = page.locator('.talent-card').filter({ has: page.getByRole('radio', { name: definition.name, exact: true }) });
    await expect(card.locator('dd').nth(0)).toHaveText(definition.introduction);
    await expect(card.locator('dd').nth(1)).toHaveText(definition.longTermImpact);
    if (mobileCreation(page)) await card.locator('.talent-choice').tap();
    else await choice(page, definition.name).check();
    await expect(choice(page, definition.name)).toBeChecked(); await expect(picker(page).locator('input:checked')).toHaveCount(1);
    expect((await draft(page)).talentId).toBe(definition.id);
    await card.locator('summary').click(); await expect(card.locator('dd').nth(2)).toHaveText(definition.mechanism);
    await expect(card.locator('dd').nth(3)).toHaveText(definition.boundary);
  }
  await choice(page, '赛博暴君').check(); await choice(page, '赛博暴君').focus(); await page.keyboard.press('ArrowRight');
  await expect(choice(page, '黄金律令')).toBeChecked(); await expect(choice(page, '黄金律令')).toBeFocused();
  const clear = page.getByRole('button', { name: '取消选择黄金律令', exact: true });
  await (mobileCreation(page) ? clear.tap() : clear.click());
  await expect(none(page)).toBeChecked(); await expect(none(page)).toBeFocused();
  expect(await draft(page)).not.toHaveProperty('talentId');
  await choice(page, '赛博暴君').check(); await page.reload(); await expect(choice(page, '赛博暴君')).toBeChecked();
  expect(await draft(page)).toEqual({ ...before, talentId: 'cyber_tyrant' });
  await frameCard(page.locator('.talent-card.selected')); await shot(page, info, 'selection-cyber');
  await noOverflow(page); unchangedRequests();
});

for (const withTalent of [true, false]) test(`五步旧草稿与正式建档：${withTalent ? '有天赋' : '清除后无天赋'}，双端档案只读`, async ({ page }, info) => {
  const unchangedRequests = noModelCalls(page); await seedCreation(page); const original = await draft(page);
  await choice(page, '天工奇才').check();
  if (!withTalent) await none(page).check();
  await step(page, '城市与背景'); await page.getByRole('radio', { name: /上海/ }).check();
  await step(page, '初始同伴'); await expect(page.getByLabel('同伴姓名')).toHaveValue(original.companion.name);
  await step(page, '确认与开局'); await showCreationReview(page);
  if (withTalent) {
    await expect(profile(page)).toContainText('天工奇才');
    if (mobileCreation(page)) {
      await expect(page.locator('.creation-ticket-talent')).toContainText('天工奇才');
      await page.locator('.creation-card').evaluate(el => { el.scrollTop = 0; }); await shot(page, info, 'confirmation-ticket');
    } else await expect(page.locator('.dz-talent')).toContainText('天工奇才');
    await profile(page).getByText('专属机制与能力边界', { exact: true }).click();
    await frameCard(profile(page)); await shot(page, info, 'confirmation');
  } else { await expect(profile(page)).toHaveCount(0); await expect(page.locator('.creation-ticket-talent, .dz-talent')).toHaveCount(0); }
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.locator('.game-layout')).toBeVisible(); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  const actual = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load('talent-ui-save'); } finally { repo.close(); }
  });
  expect(actual.protagonist).toMatchObject({ name: original.person.name, profession: original.customProfession, skills: ['修补', '沟通'], background: original.background });
  expect(actual.npc.companion).toMatchObject({ name: original.companion.name, identity: original.companion.identity });
  if (withTalent) expect(actual.protagonist.talentId).toBe('engineering_genius');
  else expect(actual.protagonist).not.toHaveProperty('talentId');
  const before = await raw(page), panel = await archive(page);
  if (withTalent) {
    await expect(profile(page)).toContainText('天工奇才'); await expect(profile(page).locator('input,select,textarea,button')).toHaveCount(0);
    await profile(page).locator('summary').click(); await expect(profile(page)).toContainText(talentDefinitions[5].boundary);
    await profile(page).scrollIntoViewIfNeeded(); await shot(page, info, 'saved-profile');
  } else await expect(profile(page)).toHaveCount(0);
  await expect(panel.locator('.profile-entrypoints button')).toHaveCount(3);
  await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible();
  expect(await raw(page)).toEqual(before); await noOverflow(page); unchangedRequests();
});

test('开局包仍完整覆盖：有天赋保存与套用，旧包回到无天赋', async ({ page }) => {
  const unchangedRequests = noModelCalls(page); await seedCreation(page);
  await page.evaluate(async () => {
    const p = '/src/ui/creation/openingPacks.ts', { OpeningPackStore } = await import(p);
    new OpeningPackStore(localStorage).save('旧无天赋包', JSON.parse(localStorage.getItem('heijin.creation.v1')!));
  });
  await choice(page, '枭雄光环').check(); await step(page, '确认与开局');
  await page.getByRole('button', { name: '保存为开局包', exact: true }).click();
  await page.getByLabel('开局包名称').fill('地下人才包'); await page.getByRole('button', { name: '保存开局包', exact: true }).click();
  for (const [name, id] of [['旧无天赋包', undefined], ['地下人才包', 'underworld_aura']] as const) {
    await step(page, '基本信息'); await page.getByRole('button', { name: '我的开局包', exact: true }).click();
    await page.getByRole('radio', { name: new RegExp(name) }).check(); await page.getByRole('button', { name: '套用开局包', exact: true }).click();
    await page.getByRole('button', { name: '确认替换并套用', exact: true }).click();
    const current = await draft(page); if (id) expect(current.talentId).toBe(id); else expect(current).not.toHaveProperty('talentId');
    await step(page, '职业与能力'); if (id) await expect(choice(page, '枭雄光环')).toBeChecked(); else await expect(none(page)).toBeChecked();
  }
  unchangedRequests();
});

test('矮屏、断点与长卡片：内部滚动、底栏可达、触控与对比度', async ({ page }, info) => {
  const unchangedRequests = noModelCalls(page); await seedCreation(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  const sizes = info.project.name === 'mobile' ? [[375, 667], [390, 844], [430, 932], [900, 600]] : [[901, 500], [1100, 580], [1440, 900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await choice(page, '绝命赌徒').check();
    const clear = page.getByRole('button', { name: '取消选择绝命赌徒', exact: true }); await clear.scrollIntoViewIfNeeded();
    await expect(clear).toBeInViewport(); await expect(page.locator('.wizard-footer .primary')).toBeInViewport();
    expect(await page.locator('.creation-card').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const bounds = await clear.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    const card = page.locator('.talent-card.selected');
    const radioBox = await card.getByRole('radio').boundingBox(), titleBox = await card.locator('b').boundingBox();
    expect(radioBox!.x + radioBox!.width).toBeLessThanOrEqual(titleBox!.x);
    for (const target of [card.locator('b'), card.locator('dd').first(), card.locator('dt').first(), card.locator('summary')]) {
      const value = await contrast(target); expect(value.ratio).toBeGreaterThanOrEqual(4.5);
      await info.attach(`creation-contrast-${width}`, { body: JSON.stringify(value), contentType: 'application/json' });
    }
    await card.locator('summary').click(); await card.locator('dd').last().scrollIntoViewIfNeeded();
    await noOverflow(page);
    if ([375, 390, 901, 1100].includes(width)) await shot(page, info, `short-${width}x${height}`);
  }
  // Day appearance currently themes the game, while creation intentionally keeps
  // its existing dark desk. Verify the new cards remain readable in that state.
  await page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { defaultSettings, settingsKey } = await import(path), settings = defaultSettings();
    settings.display.appearance = 'day'; localStorage.setItem(settingsKey, JSON.stringify(settings));
  });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
  await page.setViewportSize(mobileCreation(page) ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await expect(choice(page, '绝命赌徒')).toBeChecked(); await frameCard(page.locator('.talent-card.selected'));
  const dayCard = page.locator('.talent-card.selected');
  for (const target of [dayCard.locator('b'), dayCard.locator('dd').first(), dayCard.locator('dt').first()]) expect((await contrast(target)).ratio).toBeGreaterThanOrEqual(4.5);
  await shot(page, info, 'creation-day'); await noOverflow(page);
  unchangedRequests();
});

test('日夜正式人物档案：全文、对比度、展开关闭与 Repository 不变', async ({ page }, info) => {
  const unchangedRequests = noModelCalls(page); await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts'];
    const [{ SaveRepository }, { worldState }] = await Promise.all(paths.map(path => import(path)));
    const state = worldState(); state.openingCityId = 'chongqing'; state.protagonist.talentId = 'desperate_gambler';
    const repo = await SaveRepository.open(); try { await repo.create(state); } finally { repo.close(); }
  });
  for (const appearance of ['night', 'day'] as const) {
    await page.evaluate(async appearance => {
      const path = '/src/ui/settings/model.ts', { defaultSettings, settingsKey } = await import(path), settings = defaultSettings();
      settings.display.appearance = appearance; localStorage.setItem(settingsKey, JSON.stringify(settings));
    }, appearance);
    await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    const before = await raw(page), panel = await archive(page);
    const block = profile(page); await expect(block).toContainText('绝命赌徒'); await block.locator('summary').click();
    for (const [index, field] of (['introduction', 'longTermImpact', 'mechanism', 'boundary'] as const).entries()) {
      await expect(block.locator('dd').nth(index)).toHaveText(talentDefinitions[7][field]);
    }
    for (const target of [block.locator('h3'), block.locator('dd').first(), block.locator('dt').first(), block.locator('summary'), block.locator('.talent-readonly')]) {
      const value = await contrast(target); expect(value.ratio).toBeGreaterThanOrEqual(4.5);
      await info.attach(`profile-contrast-${appearance}`, { body: JSON.stringify(value), contentType: 'application/json' });
    }
    await frameCard(block); await shot(page, info, `profile-${appearance}`);
    await block.locator('dd').last().scrollIntoViewIfNeeded(); await shot(page, info, `profile-${appearance}-boundary`);
    await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible(); expect(await raw(page)).toEqual(before);
    await noOverflow(page);
  }
  unchangedRequests();
});
