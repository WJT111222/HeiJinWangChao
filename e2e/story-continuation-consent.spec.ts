import { devices, type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { seedLegacyWriting } from './helpers/legacy-writing';
import preset from './fixtures/story-writing/v10-preset.json' with { type: 'json' };

const suffix = '电车抵达站台。</正文><短期记忆>候车。</短期记忆><变量规划>[]</变量规划>';
const resume = (page: Page) => page.getByRole('button', { name: '续写正文', exact: true });
type Barrier = Window & { consentGate?: Promise<void>; releaseConsent?: () => void; entered?: boolean; pendingDigests?: Promise<ArrayBuffer>[] };

async function open(page: Page) {
  await seedLegacyWriting(page, preset.draft, 'preset', true);
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.locator('.story-partial')).toContainText('路牌亮起灯光');
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
    const repo = await SaveRepository.open();
    try {
      return await Promise.all(['save-a', 'save-b'].map(async id => {
        const [state, draft] = await Promise.all([repo.load(id), repo.loadDraft(id)]);
        return { revision: state.revision, turn: state.turnNumber, history: state.journal, draft };
      }));
    } finally { repo.close(); }
  });
}
async function barrier(page: Page, point: 'digest' | 'history') {
  await page.evaluate(async point => {
    const scope = window as Barrier;
    scope.consentGate = new Promise<void>(resolve => { scope.releaseConsent = resolve; });
    if (point === 'digest') {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      scope.pendingDigests = [];
      crypto.subtle.digest = (alg, data) => {
        if (!new TextDecoder().decode(data).startsWith('{"entries":')) return digest(alg,data);
        scope.entered = true;
        const result = scope.consentGate!.then(() => digest(alg,data));
        scope.pendingDigests!.push(result);
        return result;
      };
    } else {
      const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
      const read = SaveRepository.prototype.recentStoryActions;
      SaveRepository.prototype.recentStoryActions = async function (...args: unknown[]) {
        scope.entered = true;
        await scope.consentGate;
        return read.apply(this, args);
      };
    }
  }, point);
}
const release = (page: Page) => page.evaluate(() => (window as Barrier).releaseConsent!());
const entered = (page: Page) => page.waitForFunction(() => (window as Barrier).entered === true);

for (const destination of ['other', 'return', 'home', 'replace', 'double'] as const) {
  test('旧断点确认的页面及草稿作用域 · ' + destination, async ({ page }) => {
    await open(page);
    let dialogs = 0, calls = 0;
    page.on('dialog', async dialog => { dialogs++; await dialog.accept(); });
    await page.route('**/legacy.mock.invalid/**', async route => {
      calls++;
      await route.fulfill({json:{choices:[{message:{content:suffix},finish_reason:'stop'}]}});
    });
    const before = await snapshot(page);
    await barrier(page, 'digest');
    await resume(page).click();
    await entered(page);
    if (destination === 'double') {
      await resume(page).click();
    } else if (destination === 'replace') {
      await page.evaluate(async () => {
        const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
        const repo = await SaveRepository.open();
        try {
          const state = await repo.load('save-a'), draft = await repo.loadDraft('save-a');
          const pack = {state,draft:{...draft,storyPartial:{...draft.storyPartial,text:'<正文>另一份断点'}}};
          await repo.importBackup(pack,(await repo.compareBackup(pack)).confirmation,{overwrite:true});
        } finally { repo.close(); }
      });
    } else {
      await page.evaluate(dest => { location.hash = dest === 'home' ? '' : 'game/save-b'; }, destination);
      if (destination === 'home') await expect(page.locator('.story-partial')).toHaveCount(0);
      else await expect(page.locator('.story-partial')).toContainText('乙档在桥头');
      if (destination === 'return') {
        await page.evaluate(() => { location.hash = 'game/save-a'; });
        await expect(page.locator('.story-partial')).toContainText('路牌亮起灯光');
      }
    }
    const atRelease = await snapshot(page);
    expect([calls,dialogs]).toEqual([0,0]);
    await release(page);
    if (destination === 'double') {
      await expect.poll(async () => (await snapshot(page))[0].turn).toBe(before[0].turn + 1);
      expect([dialogs,calls]).toEqual([1,1]);
    } else {
      if (destination === 'replace') await expect(page.locator('.story-partial').getByText(/本次续写确认已失效/)).toBeVisible();
      // Drain the original digest operations and the resulting IDB work before checking the two stores.
      await page.evaluate(async () => {
        await Promise.all((window as Barrier).pendingDigests!);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      });
      expect(await snapshot(page)).toEqual(atRelease);
      expect([dialogs,calls]).toEqual([0,0]);
    }
  });
}

type Change = 'pace' | 'mode' | 'ui' | 'restore' | 'after-send';
async function edit(page: Page, change: Change) {
  await page.evaluate(async change => {
    const [host, lib, ui, prefs] = await Promise.all(['/src/presets/tavern/hostState.ts','/src/presets/library.ts',
      '/src/presets/peintureSettings.ts','/src/presets/settings.ts'].map(path => import(path)));
    const selected = host.captureAssistantPreferences(), pack = await lib.resolveStoryPreset(selected);
    const id = pack.definition.id, old = host.readEditorOverride(id), initial = old ?? ui.emptyOverride(pack);
    if (change === 'mode') {
      prefs.savePresetSettings({...prefs.readPresetSettings(),enabled:false,selected:null});
      return;
    }
    if (change === 'ui') {
      const next = structuredClone(initial);
      const consoleScript = pack.scripts.find((script: { id: string }) => script.id !== ui.controls.mainScript);
      (next.scriptVariables ??= {})[consoleScript.id] = { tab: 'style' };
      host.storeEditorOverride(id, old, next);
      return;
    }
    const fast = ui.toggleEntry(pack,initial,'wave-pace-fast',true);
    host.storeEditorOverride(id,old,fast);
    if (change === 'restore') host.storeEditorOverride(id,fast,ui.toggleEntry(pack,fast,'wave-pace-slow',true));
  }, change);
}
for (const tab of ['same', 'other'] as const) {
  for (const change of ['pace','mode','ui','restore','after-send'] as const) {
    test(`确认到首次 POST 的有效配置 · ${tab} · ${change}`, async ({ page, context }) => {
      await open(page);
      const editor = tab === 'same' ? page : await context.newPage();
      if (editor !== page) await editor.goto('/');
      const before = await snapshot(page), wires: string[] = [];
      const writing = await page.evaluate(async () => {
        const [lib,host]=await Promise.all(['/src/presets/library.ts','/src/presets/tavern/hostState.ts'].map(path=>import(path)));
        return lib.captureStoryWriting(host.captureAssistantPreferences(),{});
      });
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/legacy.mock.invalid/**', async route => {
        wires.push(route.request().postData()!);
        if (change === 'after-send') {
          await edit(editor, 'pace');
          await route.fulfill({json:{choices:[{message:{content:'电车还在行进。'},finish_reason:'length'}]}});
        } else await route.fulfill({json:{choices:[{message:{content:suffix},finish_reason:'stop'}]}});
      });
      await barrier(page, 'history');
      await resume(page).click();
      await entered(page);
      expect(wires).toHaveLength(0);
      if (change !== 'after-send') await edit(editor,change);
      await release(page);
      if (change === 'pace' || change === 'mode') {
        await expect(page.locator('.story-partial').getByText(/本次续写确认已失效|正文模式已在其他页面变更|文学设置与当前选择不同/)).toBeVisible();
        expect(wires).toHaveLength(0);
        expect(await snapshot(page)).toEqual(before);
      } else if (change === 'after-send') {
        await expect.poll(async () => (await snapshot(page))[0].draft.storyPartial?.writing).toEqual({...writing,prefixSource:'unknown'});
        const after = await snapshot(page);
        expect(after[0].turn).toBe(before[0].turn);
        expect(after[0].revision).toBe(before[0].revision);
        expect(after[0].draft.storyPartial.text).toContain('电车还在行进');
        expect(wires).toHaveLength(1);
      } else {
        await expect.poll(async () => (await snapshot(page))[0].turn).toBe(before[0].turn + 1);
        expect(wires).toHaveLength(1);
        expect(wires[0]).toContain('路牌亮起灯光');
        expect((await snapshot(page))[1]).toEqual(before[1]);
      }
    });
  }
}

test('宿主占位文本不改变实际 HTTP、断点指纹或刷新后的续写', async ({ page, browser }, info) => {
  const wires: Buffer[] = [];
  const prefix = '<正文>仓库门外，一列电车正在靠站。';
  async function initialize(target: Page) {
    await target.addInitScript(() => { Math.random = () => 0.43; });
    await open(target);
    await target.route('**/legacy.mock.invalid/**', async route => {
    wires.push(route.request().postDataBuffer()!);
    const wire = route.request().postDataJSON();
    const text = wires.length <= 2 ? prefix : suffix;
    const tool = wire.tools?.some((t: { function: {name: string} }) => t.function.name === 'actual_content');
    const message = tool ? {tool_calls:[{id:'delivery',type:'function',function:{name:'actual_content',arguments:JSON.stringify({content:text})}}]} : {content:text};
    await route.fulfill({json:{choices:[{message,finish_reason:tool?'tool_calls':'stop'}]}});
    });
  }
  await initialize(page);
  const read = () => snapshot(page);
  const originals = await page.evaluate(async () => {
    const {SaveRepository} = await import('/src/services/storage/saveRepository.ts' as string);
    const db = await SaveRepository.open();
    try { return {state:await db.load('save-a'),draft:await db.loadDraft('save-a')}; } finally {db.close();}
  });
  // A new known-source partial is produced from the same starting draft on both runs.
  async function initialRun(target: Page) {
    await target.evaluate(async () => {
      const [store,fixtures,drafts,models,credentials,workflow,settings] = await Promise.all([
        '/src/services/storage/saveRepository.ts','/src/tests/fixtures/talentPrompt.ts','/src/domain/drafts.ts',
        '/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/workflows/storyStage.ts','/src/ui/settings/model.ts',
      ].map(path=>import(path)));
      const repo=await store.SaveRepository.open(), stage=new workflow.StoryStage(repo);
      try {
        const {state,userInput}=fixtures.talentPromptInput('story','regular');
        const draft=drafts.createTurnDraft(state.saveId,state.revision,'marker-wire','regular',userInput,false,false);
        const pack={state,draft};
        await repo.importBackup(pack,(await repo.compareBackup(pack)).confirmation,{overwrite:true});
        try {
          await stage.generate({draft:await repo.loadDraft(state.saveId),settings:JSON.parse(localStorage.getItem(settings.settingsKey)!),
            config:models.readAiConfig(localStorage),vault:new credentials.CredentialVault(sessionStorage,localStorage),onFailureSaved() {}});
          throw new Error('预期首次响应保留为可续写断点');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code==='invalid_output')) throw error;
        }
      } finally {stage.dispose();repo.close();}
    });
    await expect.poll(async () => (await snapshot(target))[0].draft.storyPartial?.text).toBe(prefix);
    return (await snapshot(target))[0].draft;
  }
  const first = await initialRun(page);
  function editMarkers(target: Page) {
    return target.evaluate(async () => {
      const [host,lib,ui] = await Promise.all(['/src/presets/tavern/hostState.ts','/src/presets/library.ts',
        '/src/presets/peintureSettings.ts'].map(path=>import(path)));
    const preset=await lib.resolveStoryPreset(host.captureAssistantPreferences());
    const id=preset.definition.id, old=host.readEditorOverride(id), next=structuredClone(old??ui.emptyOverride(preset));
    next.entries.chatHistory={content:'未读取的历史占位文本'};
    next.entries.worldInfoBefore={content:'未读取的世界资料占位文本'};
    host.storeEditorOverride(id,old,next);
    });
  }
  const context = await browser.newContext({...devices[info.project.name === 'mobile' ? 'Pixel 7' : 'Desktop Chrome'],
    baseURL:new URL(page.url()).origin});
  let second;
  try {
    const other = await context.newPage();
    await initialize(other);
    await editMarkers(other);
    second = await initialRun(other);
  } finally { await context.close(); }
  await editMarkers(page);
  expect(wires).toHaveLength(2);
  expect(wires[0].equals(wires[1])).toBe(true);
  expect(second.storyPartial.writing).toEqual(first.storyPartial.writing);
  await page.reload();
  await resume(page).click();
  await expect.poll(async () => (await read())[0].turn).toBe(originals.state.turnNumber+1);
  expect(wires).toHaveLength(3);
  await info.attach('有效字段对照',{body:JSON.stringify({bytes:wires[0].length, configuration:second.storyPartial.writing.configuration,
    sameWire:wires[0].equals(wires[1]),calls:wires.length}),contentType:'application/json'});
});
