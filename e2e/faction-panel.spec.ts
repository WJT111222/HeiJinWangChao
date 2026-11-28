import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedRoster, rosterGame } from './helpers/npcRoster';
import { openWorldArchive } from './helpers/gameLayout';

async function openFaction(page: Page) {
  await expect(page.locator('.game-layout')).toBeVisible();
  await openWorldArchive(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /我的势力/ }).click();
  const dialog = page.getByRole('dialog', { name: '我的势力', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
async function bindFaction(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    const state = await repo.load('save-a'); repo.close();
    state.organizations['org-mine'] = { id: 'org-mine', kind: 'gang', name: '青龙会', description: '以夜场和码头生意起家的本地帮派。',
      protagonistRelation: '正式成员', relationHistory: ['拜码头入会'], keyNpcIds: [], currentTaskIds: [], industries: ['夜场', '码头货运'],
      territoryText: '解放碑一带', reputationText: '道上都知道', leadership: [{ position: '话事人', publicName: '龙叔' }],
      departments: [{ id: 'dept-door', name: '看场组', duty: '夜场看场', headPosition: '红棍', headPublicName: state.npc.person.name, headNpcId: 'person' }],
      members: [{ npcId: 'person', position: '红棍', departmentId: 'dept-door' }],
      protagonistKnown: [{ id: 'k1', category: 'intel', text: '账由二把手的人亲自来收', source: '夜班时亲眼看到', learnedAt: state.worldClock, knowledgeKind: 'observed' }] };
    state.protagonistFaction = { organizationId: 'org-mine', position: '看场', departmentId: 'dept-door', joinedAt: state.worldClock, bondText: '由红棍引荐入会，在夜场看场' };
    await new Promise<void>((resolve, reject) => { const q = indexedDB.open('heijinwangchao'); q.onerror = () => reject(q.error);
      q.onsuccess = () => { const db = q.result, t = db.transaction('saves', 'readwrite'); t.objectStore('saves').put(state);
        t.oncomplete = () => { db.close(); resolve(); }; t.onabort = () => reject(t.error); }; });
  });
  await page.reload();
}

test('我的势力：未绑定显示孤身一人，只读不写状态', async ({ page }) => {
  await seedRoster(page); await page.route('https://**/*', route => route.abort());
  const before = await rosterGame(page);
  const dialog = await openFaction(page);
  await expect(dialog).toContainText('目前孤身一人');
  expect(await rosterGame(page)).toEqual(before);
});

test('我的势力：显示公开信息、部门与内情，点名字跳到人物资料', async ({ page }) => {
  await seedRoster(page); await page.route('https://**/*', route => route.abort());
  await bindFaction(page);
  const before = await rosterGame(page), name = before.state.npc.person.name;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const dialog = await openFaction(page);
  for (const text of ['青龙会', '我的身份：看场', '由红棍引荐入会，在夜场看场', '话事人 · 龙叔', '道上都知道', '看场组', '我在这里', '账由二把手的人亲自来收'])
    await expect(dialog).toContainText(text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: `查看人物：${name}（红棍）`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toBeVisible();
  expect(await rosterGame(page)).toEqual(before); expect(errors).toEqual([]);
});
