import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { enterArchiveGame, openArchive, openEconomy } from './helpers/mobileArchives';
import type { Kind, Picture, Slot } from '../src/services/images/model';
import { writeFile } from 'node:fs/promises';

declare global {
  interface Window {
    pictureReads: string[];
    pictureBulkReads: number;
    pictureUrls: Set<string>;
  }
}
const evidence = 'docs/image-generation/evidence/';
async function seed(page: Page, mobile: boolean, turns = 1) {
  await page.addInitScript(() => {
    window.pictureReads = [];
    window.pictureBulkReads = 0;
    window.pictureUrls = new Set();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      if (value instanceof Blob && value.type.startsWith('image/')) window.pictureUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.pictureUrls.delete(url);
      revoke(url);
    };
    const get = IDBObjectStore.prototype.get,
      all = IDBIndex.prototype.getAll;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'imageFiles') window.pictureReads.push(JSON.stringify(key));
      return get.call(this, key);
    };
    IDBIndex.prototype.getAll = function (...args) {
      if (this.objectStore.name === 'imageFiles') window.pictureBulkReads++;
      return all.apply(this, args);
    };
  });
  await page.goto('/');
  await page.evaluate(
    async ({ mobile, turns }) => {
      const paths = [
        '/src/services/storage/saveRepository.ts',
        '/src/tests/fixtures/harem.ts',
        '/src/services/images/model.ts',
        '/src/ui/settings/model.ts',
        '/src/services/images/config.ts',
      ];
      const [
        { SaveRepository },
        { householdFixture },
        { targetFor },
        { defaultSettings, settingsKey },
        { config, saveConfig },
      ] = await Promise.all(paths.map((p) => import(p)));
      const s = householdFixture(2);
      s.npc['family-0'].name = '沈宁';
      s.openingTimePending = s.openingInitializationPending = undefined;
      s.items.ring = {
        id: 'ring',
        name: '银戒指',
        category: 'accessory',
        quantity: 1,
        conditionText: '完好',
        ownerRef: { kind: 'protagonist', id: 'hero' },
      };
      s.economy.vehicles.car = {
        id: 'car',
        name: '家用轿车',
        model: '四门轿车',
        kind: 'vehicle',
        source: '购入',
        statusText: '在用',
        estimatedValue: null,
        ownerRef: { kind: 'protagonist', id: 'hero' },
      };
      const narrative =
        '窗边的书翻到一半。沈宁听见钥匙转动，抬头看了看刚进门的林舟。窗外江水泛光，楼下驶过一辆白色轿车。';
      s.revision = s.turnNumber = turns;
      s.journal = Array.from({ length: turns }, (_, i) => ({
        turnId: 'frame-' + i,
        revision: i + 1,
        relatedActorRefs: [{ kind: 'npc', id: 'family-0' }],
        scene: { worldClock: s.worldClock, locationId: 'chongqing' },
        story: {
          turnKind: i ? 'regular' : 'opening',
          narrative: narrative.repeat(turns > 1 ? 12 : 1),
          summary: '午后在家中阅读。',
          variableGuide: [],
        },
      }));
      // Original geometric illustrations made for this fixture; no model or remote assets.
      function art(vertical: boolean) {
        const canvas = document.createElement('canvas');
        canvas.width = vertical ? 420 : 960;
        canvas.height = vertical ? 640 : 540;
        const g = canvas.getContext('2d')!,
          w = canvas.width,
          h = canvas.height;
        g.fillStyle = '#ece1c7';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#98a698';
        g.fillRect(w * 0.08, h * 0.08, w * 0.46, h * 0.58);
        g.fillStyle = '#f5c77e';
        g.beginPath();
        g.arc(w * 0.24, h * 0.25, w * 0.07, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#647f78';
        g.beginPath();
        g.moveTo(w * 0.08, h * 0.5);
        g.lineTo(w * 0.3, h * 0.32);
        g.lineTo(w * 0.54, h * 0.52);
        g.lineTo(w * 0.54, h * 0.66);
        g.lineTo(w * 0.08, h * 0.66);
        g.fill();
        g.fillStyle = '#e0cfab';
        g.fillRect(w * 0.29, h * 0.08, w * 0.018, h * 0.58);
        g.fillRect(w * 0.08, h * 0.43, w * 0.46, h * 0.018);
        g.fillStyle = '#3c4845';
        g.beginPath();
        g.ellipse(w * 0.69, h * 0.4, w * 0.082, h * 0.12, -0.12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#c49170';
        g.beginPath();
        g.ellipse(w * 0.68, h * 0.425, w * 0.062, h * 0.084, -0.12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#546c62';
        g.beginPath();
        g.ellipse(w * 0.67, h * 0.82, w * 0.21, h * 0.29, 0.1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#9d6149';
        g.fillRect(0, h * 0.84, w, h * 0.16);
        g.fillStyle = '#f8ead1';
        g.beginPath();
        g.moveTo(w * 0.31, h * 0.72);
        g.lineTo(w * 0.47, h * 0.69);
        g.lineTo(w * 0.57, h * 0.75);
        g.lineTo(w * 0.67, h * 0.68);
        g.lineTo(w * 0.75, h * 0.73);
        g.lineTo(w * 0.57, h * 0.85);
        g.fill();
        return canvas.toDataURL('image/png').split(',')[1];
      }
      const portrait = art(true),
        scene = art(false);
      const pictures: Picture[] = [],
        files: { id: string; data: string }[] = [];
      function add(kind: Kind, id: string, slot: Slot) {
        const data = kind === 'npc' || kind === 'player' ? portrait : scene;
        const resourceId = [kind, id, slot].join('-');
        pictures.push({
          id: resourceId,
          target: targetFor(s, kind, id),
          slot,
          current: true,
          created: s.createdAt,
          mime: 'image/png',
          bytes: atob(data).length,
        });
        files.push({ id: resourceId, data });
      }
      for (let i = 0; i < turns; i++) add('story', 'frame-' + i, 'illustration');
      add('player', 'hero', 'avatar');
      for (const slot of ['home', 'avatar', 'bust', 'full'] as const) add('npc', 'family-0', slot);
      add('place', 'chongqing', 'location');
      add('item', 'ring', 'object');
      add('vehicle', 'car', 'object');
      const repo = await SaveRepository.open();
      try {
        const input = {
          state: s,
          images: { saveId: s.saveId, createdAt: s.createdAt, pictures, files, anchors: [] },
        };
        await repo.importBackup(input, (await repo.compareBackup(input)).confirmation);
      } finally {
        repo.close();
      }
      const settings = defaultSettings();
      settings.display.appearance = mobile ? 'day' : 'night';
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      await saveConfig(config(), { ...config(), enabled: turns === 1 });
    },
    { mobile, turns },
  );
  await enterArchiveGame(page);
}

test('人物、居家与业务资料仅展示选图，退出家庭后可从图库导出', async ({ page, isMobile }, info) => {
  test.setTimeout(100000);
  await seed(page, isMobile);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  const prefix = evidence + info.project.name + '-display-';
  const story = page.locator('.story-entry .thumb-story button');
  await expect(story).toBeVisible();
  await story.scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'story.png' });
  await story.click();
  await expect(page.locator('.image-full')).toBeVisible();
  expect(await page.locator('.image-full').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(960);
  await page.keyboard.press('Escape');
  const household = await openArchive(page, '后宫');
  await household.locator('.household-card button[data-person-id="family-0"]').click();
  const family = page.getByRole('dialog', { name: 'NPC 人物档案', exact: true });
  const fold = family.locator('.compact-portraits').filter({ hasText: '查看居家照' }).locator('summary');
  if (await fold.isVisible()) await fold.click();
  const home = family.locator('.thumb-home button:visible');
  await expect(home).toBeVisible();
  await home.scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'home.png' });
  await home.click();
  await expect(page.locator('.image-full')).toBeVisible();
  await page.keyboard.press('Escape');
  await family.getByRole('button', { name: '管理居家照' }).click();
  await expect(page.getByLabel('图片用途')).toHaveValue('home');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const npc = await openArchive(page, 'NPC');
  const row = npc.locator('.illustrated-person').filter({ hasText: '沈宁' });
  await expect(row.locator('.thumb-avatar button')).toBeVisible();
  await page.screenshot({ path: prefix + 'roster.png' });
  await row.locator('.thumb-avatar button').click();
  await expect(page.locator('.image-full')).toBeVisible();
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: '查看人物：沈宁', exact: true }).click();
  const show = npc.locator('.compact-portraits summary').filter({ hasText: '查看人物立绘' });
  if (await show.isVisible()) await show.click();
  for (const slot of ['bust', 'full'])
    await expect(npc.locator('.thumb-' + slot + ' button:visible')).toBeVisible();
  await npc.locator('.thumb-full button:visible').scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'portraits.png' });
  await page.keyboard.press('Escape');
  const map = await openArchive(page, '地图');
  const mapButton = map.getByRole('button', { name: '查看地点：重庆', exact: true }).first();
  if (await mapButton.isVisible()) await mapButton.click();
  await expect(map.locator('.thumb-place button')).toBeVisible();
  await map.locator('.thumb-place').scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'place.png' });
  await page.keyboard.press('Escape');
  const bag = await openArchive(page, '物品栏');
  await bag.locator('[data-item-id="ring"]').click();
  await expect(bag.locator('.thumb-item button')).toBeVisible();
  await bag.locator('.thumb-item').scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'item.png' });
  await page.keyboard.press('Escape');
  if (isMobile && (await bag.isVisible()))
    await bag.getByRole('button', { name: '关闭资料界面', exact: true }).click();
  const economy = await openEconomy(page);
  if (isMobile) await economy.getByRole('button', { name: /^资产 \d/ }).click();
  await expect(economy.locator('[data-asset-id="car"] .thumb-vehicle button')).toBeVisible();
  await economy.locator('.thumb-vehicle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + 'vehicle.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/domain/commands.ts'];
    const [{ SaveRepository }, { commitCommands }] = await Promise.all(paths.map((p) => import(p)));
    const repo = await SaveRepository.open();
    try {
      const { state } = await repo.loadGame('save-a');
      const next = commitCommands(
        state,
        'left-family',
        state.revision,
        [
          {
            type: 'ApplyHaremChanges',
            commandId: 'leave-one',
            expectedRevision: state.revision,
            evidence: '已离开',
            changes: [
              { op: 'leave', npcId: 'family-0', from: 100, reason: '搬离家庭' },
              { op: 'score', npcId: 'family-1', from: 94, to: 100, reason: '成员商定新的家庭安排' },
            ],
          },
        ],
        state.updatedAt,
      );
      const input = { state: next };
      await repo.importBackup(input, (await repo.compareBackup(input)).confirmation, { overwrite: true });
    } finally {
      repo.close();
    }
  });
  await enterArchiveGame(page);
  const hh = await openArchive(page, '后宫');
  await expect(hh.locator('.household-card[data-member-id="family-0"]')).toHaveCount(0);
  await hh.locator('.hh-exited summary').click();
  await hh.locator('.hh-exited button[data-person-id="family-0"]').click();
  await expect(page.getByRole('button', { name: '管理居家照' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const { openSettings } = await import('./helpers/gameLayout');
  await openSettings(page);
  await page.getByRole('button', { name: '文生图', exact: true }).click();
  await page.getByRole('button', { name: '图片管理器' }).click();
  const filter = page.getByLabel('分类', { exact: true });
  await filter.selectOption('vehicle');
  await expect(page.locator('.image-record')).toHaveCount(1);
  await expect(page.locator('.image-record')).toContainText('家用轿车');
  await filter.selectOption('home');
  await expect(page.locator('.image-record')).toHaveCount(1);
  await expect(page.locator('.image-record')).toContainText('沈宁');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出图片' }).click();
  expect((await download).suggestedFilename()).toBe('沈宁.png');
  expect(posts).toEqual([]);
});

test('长正文与三百张插画按视口读取并释放缩略图', async ({ page, isMobile }, info) => {
  test.setTimeout(120000);
  await seed(page, isMobile, 300);
  const reader = page.getByTestId('story-reader');
  await expect(page.locator('.story-entry')).toHaveCount(300);
  const metric = () =>
    page.evaluate(() => ({
      reads: window.pictureReads.length,
      bulk: window.pictureBulkReads,
      liveUrls: window.pictureUrls.size,
      mounted: document.querySelectorAll('.picture-thumb img').length,
      entries: document.querySelectorAll('.story-entry').length,
    }));
  const scrollFrames = () =>
    reader.evaluate(async (el) => {
      let owner: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement;
      while (
        owner &&
        !(
          owner.scrollHeight > owner.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(owner).overflowY)
        )
      )
        owner = owner.parentElement;
      owner ??= document.scrollingElement as HTMLElement;
      const start = owner.scrollTop,
        timings: number[] = [];
      owner.scrollTop = 0;
      let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      for (let i = 0; i < 48; i++) {
        owner.scrollTop += 90;
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        timings.push(now - last);
        last = now;
      }
      const distance = owner.scrollTop;
      owner.scrollTop = start;
      timings.sort((a, b) => a - b);
      return {
        frames: timings.length,
        distance,
        medianMs: Math.round(timings[24]),
        p95Ms: Math.round(timings[45]),
        over50Ms: timings.filter((v) => v > 50).length,
      };
    });
  const textFrames = await scrollFrames();
  expect(textFrames.distance).toBeGreaterThan(500);
  const disabled = await metric();
  expect(disabled.reads).toBe(0);
  const timeToThumbnailsMs = await page.evaluate(async () => {
    const path = '/src/services/images/config.ts',
      { config, saveConfig } = await import(path);
    const start = performance.now();
    await saveConfig(config(), { ...config(), enabled: true });
    while (
      ![...document.querySelectorAll<HTMLImageElement>('.thumb-story img')].some(
        (img) => img.complete && img.naturalWidth,
      )
    ) {
      if (performance.now() - start > 10000) throw Error('首幅插画读取超时');
      await new Promise(requestAnimationFrame);
    }
    return Math.round(performance.now() - start);
  });
  const initial = await metric();
  expect(initial.reads).toBeLessThan(20);
  expect(initial.bulk).toBe(0);
  const imageFrames = await scrollFrames();
  const sample: number[] = [];
  for (const i of [0, 75, 150, 225, 299]) {
    const frame = page.locator('.story-entry').nth(i).locator('.thumb-story');
    await frame.scrollIntoViewIfNeeded();
    sample.push(
      await frame.evaluate(async (el) => {
        const start = performance.now();
        while (!el.querySelector('img')?.naturalWidth) {
          if (performance.now() - start > 10000) throw Error('插画读取超时');
          await new Promise(requestAnimationFrame);
        }
        return Math.round(performance.now() - start);
      }),
    );
  }
  const scrolled = await metric();
  expect(scrolled.mounted).toBeLessThan(20);
  expect(scrolled.reads).toBeLessThan(60);
  expect(scrolled.bulk).toBe(0);
  await page.evaluate(async () => {
    const path = '/src/services/images/config.ts',
      { config, saveConfig } = await import(path);
    await saveConfig(config(), { ...config(), enabled: false });
  });
  await expect(page.locator('.picture-thumb')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.pictureUrls.size)).toBe(0);
  const off = await metric();
  await reader.evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(180);
  expect((await metric()).reads).toBe(off.reads);
  const result = {
    project: info.project.name,
    turns: 300,
    pictures: 308,
    sourceSize: '960×540',
    disabled,
    initial,
    scrolled,
    off,
    textFrames,
    imageFrames,
    timeToThumbnailsMs,
    scrollThumbnailWaitMs: sample,
  };
  await writeFile(
    evidence + info.project.name + '-display-performance.json',
    JSON.stringify(result, null, 2) + '\n',
  );
});

test('跨标签替换、同名切档和损坏资源回退', async ({ page, context, isMobile }) => {
  await seed(page, isMobile);
  await expect(page.locator('.thumb-story img')).toBeVisible();
  const second = await context.newPage();
  await second.goto('/');
  await second.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try {
      const s = await repo.load('save-a'),
        other = { state: { ...s, saveId: 'save-b' } };
      await repo.importBackup(other, (await repo.compareBackup(other)).confirmation);
      const [backup] = await repo.exportBackup(['save-a']);
      await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation, { overwrite: true });
    } finally {
      repo.close();
    }
  });
  await expect(page.locator('.thumb-story img')).toHaveCount(0);
  await page.goto('/#game/save-b');
  await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看或生成插画' })).toBeVisible();
  expect(await page.evaluate(() => window.pictureReads.length)).toBe(0);
  await second.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('heijinwangchao');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('imageFiles', 'readwrite');
        tx.objectStore('imageFiles').put({
          saveId: 'save-a',
          id: 'story-frame-0-illustration',
          data: 'aW52YWxpZA==',
        });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await enterArchiveGame(page);
  await expect(page.locator('.thumb-story')).toHaveAttribute('data-unavailable', 'true');
  await expect(page.locator('.thumb-story img')).toHaveCount(0);
  await expect(page.locator('.story-entry')).toContainText('窗边的书');
  const reads = await page.evaluate(() => window.pictureReads.length);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.pictureReads.length)).toBe(reads);
  await second.close();
});

test('手动重绘居家照后上传、切换、删除及家庭预览均复用原资源', async ({ page, isMobile }) => {
  await seed(page, isMobile);
  const posts: string[] = [];
  await page.route('**/household-image-fixture', async (route) => {
    posts.push(route.request().postDataJSON().prompt);
    await route.fulfill({
      json: {
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==',
          },
        ],
      },
    });
  });
  await page.evaluate(async () => {
    const path = '/src/services/images/config.ts',
      { config, saveConfig } = await import(path),
      c = config();
    c.connections.openai.base = location.origin;
    c.connections.openai.path = 'household-image-fixture';
    await saveConfig(config(), c);
  });
  const hh = await openArchive(page, '后宫');
  await hh.locator('.household-card [data-person-id="family-0"]').click();
  await page.getByRole('button', { name: '管理居家照' }).click();
  const gallery = page.locator('.image-tools');
  await gallery.getByRole('button', { name: '重新绘制' }).click();
  await expect(gallery.locator('.image-record')).toHaveCount(2);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain('日常');
  expect(posts[0]).toContain('沈宁');
  await gallery.getByLabel('本地上传').setInputFiles({
    name: 'home.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(gallery.locator('.image-record')).toHaveCount(3);
  await gallery.locator('.image-record').last().getByRole('button', { name: '选为当前' }).click();
  await expect(gallery.locator('.image-record').last()).toContainText('当前使用');
  await gallery.locator('.image-record').first().getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除图片' }).click();
  await expect(gallery.locator('.image-record')).toHaveCount(2);
  await gallery.getByLabel('图片用途').selectOption('avatar');
  await expect(gallery.locator('.image-record')).toHaveCount(1);
  await expect(gallery.locator('.image-record')).toContainText('当前使用');
  expect(posts).toHaveLength(1);
});

test('主角状态和资料共享头像缩略图，点击才读取原图', async ({ page, isMobile }, info) => {
  await seed(page, isMobile);
  if (isMobile) await page.locator('[data-mobile-tab="hero"]').click();
  const status = page.locator(
    isMobile ? '.st-hero .thumb-avatar button' : '.status-seal .thumb-avatar button',
  );
  await expect(status).toBeVisible();
  const reads = () =>
    page.evaluate(() => window.pictureReads.filter((key) => key.includes('player-hero-avatar')).length);
  expect(await reads()).toBe(1);
  await page.getByRole('button', { name: '人物档案', exact: true }).click();
  const profile = page.locator(
    isMobile ? '.mobile-archive .modal-body > .thumb-avatar button' : '.pf-photo .thumb-avatar button',
  );
  await expect(profile).toBeVisible();
  expect(await reads()).toBe(1);
  await page.screenshot({ path: evidence + info.project.name + '-display-hero.png' });
  await profile.click();
  await expect(page.locator('.image-full')).toBeVisible();
  expect(await reads()).toBe(2);
  expect(
    await page
      .locator('.image-full')
      .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
  ).toEqual([420, 640]);
});
