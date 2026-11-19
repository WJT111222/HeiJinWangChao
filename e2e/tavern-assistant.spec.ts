import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

async function settings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const back = dialog.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name: '运行', exact: true }).click();
  return dialog;
}
test('启用内置脚本：首次 Story、JSON/SSE、状态按钮、取消与刷新', async ({ page }, info) => {
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(u.hostname) || u.protocol === 'blob:' ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    const native = window.fetch.bind(window);
    const sent: Record<string, unknown>[] = [];
    Object.assign(window, { sent });
    window.fetch = async (url, init) => {
      if (!String(url).startsWith('https://assistant.mock.invalid/')) return native(url,init);
      const data = JSON.parse(String(init?.body));
      sent.push(data);
      if (data.model === 'hold') return new Promise((_ok,fail) => {
        document.dispatchEvent(new Event('fixture-hold'));
        init?.signal?.addEventListener('abort', () => fail(new DOMException('cancel','AbortError')), { once: true });
      });
      const content = data.model === 'continuation' ? '站在街口。</正文><短期记忆>在街口等车</短期记忆><变量规划>[]</变量规划>' : '<正文>电车驶过石桥，林舟站在街口。</正文><短期记忆>在街口等车</短期记忆><变量规划>[]</变量规划>';
      if (!data.tools) return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
      const call = { index: 0, type: 'function', id: 'fixture', function: { name: 'actual_content', arguments: JSON.stringify({ content }) } };
      if (!data.stream || data.model === 'whole-json') return Response.json({ choices: [{ message: { tool_calls: [call] }, finish_reason: 'tool_calls' }], usage: { completion_tokens: 17 } });
      const frames = [{ choices: [{ delta: { tool_calls: [call] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { completion_tokens: 19 } }];
      return new Response(frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  const dialog = await settings(page);
  await dialog.getByLabel('正文预设').selectOption('peinture-1118');
  await Promise.all([page.waitForNavigation(), dialog.getByRole('button', { name: '保存预设并刷新' }).click()]);
  const result = await page.evaluate(async () => {
    const paths = ['/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts',
      '/src/tests/fixtures/game.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts',
      '/src/presets/tavern/hostState.ts','/src/services/ai/stageResponses.ts'];
    const [{StoryStage},{SaveRepository},{createTurnDraft},{game},{defaultSettings},{newChannel,defaultAiConfig},{CredentialVault},
      {assistantView},{stageResponses}] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open(), state = await repo.create(game('assistant-qa'));
    const draft = createTurnDraft(state.saveId,state.revision,'qa','opening','');
    await repo.saveDraft(draft,null);
    const stage = new StoryStage(repo), config = defaultAiConfig(), vault = new CredentialVault(sessionStorage,localStorage);
    const channel = newChannel('openai');
    channel.baseUrl = 'https://assistant.mock.invalid/v1'; channel.defaultModel = 'fixture'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: '' };
    vault.set(channel.id,'fixture-only');
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    const sent = (window as unknown as { sent: { tools?: { function: { name: string; description: string } }[]; messages: { content: string }[]; temperature: number }[] }).sent;
    const observations = [];
    let current = draft;
    try {
      const {tavernEvents} = await import('/src/presets/tavern/events.ts' as string);
      const types: string[] = [];
      tavernEvents.on('generation_started', (type:string) => {types.push(type);});
      for (const stream of [false,true]) {
        settings.runtime.streamStory = stream;
        current = await stage.generate({ draft: current, config, vault, settings });
        const wire = sent.at(-1)!;
        observations.push({ text: current.story.narrative, saved: (await repo.loadDraft(state.saveId)).story.narrative,
          names: wire.tools?.map(t => t.function.name), moved: wire.tools?.some(t => t.function.name === 'wave_context_reference' && t.function.description.includes('林舟')),
          outputRule: wire.messages.some(m => m.content.includes('actual_content')), temperature: wire.temperature,
          trace: stageResponses.getSnapshot()[0].diagnostics.tavern });
      }
      channel.defaultModel = 'hold';
      const waiting = new Promise(resolve => document.addEventListener('fixture-hold',resolve,{once:true}));
      const pending = stage.generate({ draft: current, config, vault, settings }).catch((e: {code:string}) => e.code);
      await waiting;
      const realm = document.querySelector<HTMLIFrameElement>('iframe[data-tavern-script]')!.contentWindow as unknown as {
        getContext():{chatCompletionSettings:{temp_openai:number};saveSettingsDebounced():void};
      };
      const live = realm.getContext();
      live.chatCompletionSettings.temp_openai = 0.23;
      live.saveSettingsDebounced();
      stage.cancel();
      const cancelled = await pending;
      const saved = await repo.loadDraft(state.saveId);
      channel.defaultModel = 'whole-json';
      const next = await stage.generate({ draft:saved,config,vault,settings });
      const afterCancel = (await repo.loadDraft(state.saveId)).story.narrative;
      channel.defaultModel = 'continuation';
      const {runStageRequest} = await import('/src/services/ai/runtime.ts' as string);
      const continued = await runStageRequest({ stage:'story',mode:'opening',state,draft:next,settings,userInput:'' },
        config,vault,{continuation:{partial:'<正文>电车驶过石桥，林舟'},stream:false});
      const continuationTool = sent.at(-1)?.tools;
      const stop = tavernEvents.on('chat_completion_settings_ready', () => {throw Error('fixture listener');});
      const rejected = await stage.generate({draft:next,config,vault,settings}).catch((e:{code:string})=>e.code);
      stop.stop();
      const unchanged = (await repo.loadDraft(state.saveId)).draftRevision === next.draftRevision;
      return { observations, temperatures:sent.map(w => w.temperature), requests: sent.length, cancelled, types, continued:continued.result.narrative, continuationTool, afterCancel, rejected, unchanged, previous: saved.draftRevision === current.draftRevision,
        revision: (await repo.load(state.saveId)).revision === state.revision, rows: assistantView.snapshot() };
    } catch (error) {
      throw new Error(JSON.stringify({ error:String(error), rows: assistantView.snapshot(), requests: sent.length,
        names:sent.at(-1)?.tools?.map(t=>t.function.name) }), { cause: error });
    } finally { repo.close(); }
  });
  expect(result.requests).toBe(5);
  expect(result).toMatchObject({ types:['normal','regenerate','regenerate','regenerate','continue','regenerate'],
    afterCancel:'电车驶过石桥，林舟站在街口。', rejected:'configuration', unchanged:true });
  expect(result.continued).toContain('站在街口。');
  expect(result.continuationTool).toBeUndefined();
  expect(result.temperatures.slice(0,4)).toEqual([1,1,1,0.23]);
  expect(result).toMatchObject({ cancelled:'cancelled', previous:true, revision:true });
  for (const [i, o] of result.observations.entries()) {
    expect(o).toMatchObject({ text:'电车驶过石桥，林舟站在街口。', saved:'电车驶过石桥，林舟站在街口。', moved:true, outputRule:true,
      names:['wave_context_reference','actual_content'], trace:{ calls:1, upstreamUsage:{ outputTokens:i ? 19:17 },complete:true } });
  }
  await page.goto('/#game/assistant-qa');
  if (info.project.name === 'mobile') await page.getByRole('button',{ name:'三阶段工作流详情' }).click();
  await page.getByRole('button',{name:'浪潮·状态', exact:true}).click();
  await expect(page.getByRole('dialog',{name:'浪潮状态面板'})).toBeVisible();
  await info.attach('原脚本状态面板', {body:await page.screenshot({ path: info.outputPath('status.png') }),contentType:'image/png'});
  await page.getByRole('button',{name:'关闭资料发送状态'}).click();
  await page.goto('/');
  const reopened = await settings(page);
  await expect(reopened.getByLabel('正文预设')).toHaveValue('peinture-1118');
  await reopened.getByLabel('正文预设').selectOption('');
  await Promise.all([page.waitForNavigation(), reopened.getByRole('button',{name:'保存预设并刷新'}).click()]);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {sent:unknown[]}).sent.length)).toBe(0);
});

test('自写模块及普通脚本在独立实例使用按钮、活配置、作用域与同步/异步事件', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const paths = ['/src/presets/tavern/scriptHost.ts','/src/presets/package.ts','/src/presets/tavern/hostState.ts',
      '/src/presets/tavern/events.ts','/src/tests/fixtures/game.ts','/src/ui/settings/model.ts'];
    const [{mountPresetScripts},{loadPreset},{assistantView,bindTavernPage,pressScriptButton},{tavernTools},{game},{defaultSettings}] =
      await Promise.all(paths.map(p => import(p)));
    const text = `$(async function () {
      if (this !== parent.document || TavernHelper.getScriptId() !== getScriptId()) throw Error('ready/instance');
      const c = getContext(), live = c.chatCompletionSettings;
      if (c === getContext() || live !== getContext().chatCompletionSettings) throw Error('unstable context');
      const preset = getPreset(); preset.prompts[0].content = 'copy';
      if (getPreset().prompts[0].content === 'copy' || !getPreset().prompts_unused.length) throw Error('mutable preset');
      appendInexistentScriptButtons([{name:'同名按钮',visible:true}]);
      const id = getScriptId();
      eventOn(getButtonEvent('同名按钮'), () => { insertOrAssignVariables({ clicks: 1 },{type:'script'}); });
      eventOnce('ordering-' + id, () => { parent.fixtureOrder.push('once'); eventEmitAndWait('ordering-' + id); });
      const removed = eventOn('ordering-' + id, () => parent.fixtureOrder.push('removed')); removed.stop();
      const kept = () => parent.fixtureOrder.push('kept');
      eventMakeLast('ordering-' + id, kept); eventMakeFirst('ordering-' + id, kept);
      await eventEmit('ordering-' + id);
      eventClearAll('ordering-' + id);
      eventEmitAndWait('ordering-' + id);
      registerFunctionTool({ name:id, parameters:{type:'object'}, description:id, shouldRegister:() => false });
      const registered = getContext().ToolManager.tools.find(tool => tool.name === id);
      if (!registered || registered.toFunctionOpenAI().function.name !== id) throw Error('tool identity');
      replaceVariables({ owner:id },{type:'script'});
      await Promise.resolve();
      parent.fixtureOrder.push(id);
    });`;
    const scripts = ['b','a'].map(id => ({ type:'script', id, name:id, content:text, module:id==='a', enabled:true, button:{enabled:true,buttons:[]} }));
    const raw = { prompts:[{identifier:'q',content:'text'},{identifier:'unused',content:'unused'}],
      prompt_order:[{character_id:100001,order:[{identifier:'q',enabled:true}]}],
      extensions:{tavern_helper:{scripts:[...scripts,{type:'folder',enabled:false,scripts:[{...scripts[0],id:'disabled',content:'throw Error()'}]}]}} };
    const preset = loadPreset(JSON.stringify(raw),{id:'interface-fixture',version:'1',lockedOff:[]});
    const fixtureOrder: string[] = [];
    Object.assign(window,{fixtureOrder});
    let active = game('first');
    const stop = bindTavernPage(() => ({stage:'story',mode:'regular',state:active,settings:defaultSettings(),userInput:'等车'}),() => {});
    try {
      await mountPresetScripts(preset);
      const instance = (id:string) => document.querySelector<HTMLIFrameElement>('iframe[data-tavern-script="'+id+'"]')!.contentWindow!;
      const a = instance('a') as Window & {TavernHelper:{
        getVariables(o?:{type:string}):Record<string,unknown>;replaceVariables(v:unknown,o?:{type:string}):void;
        getChatMessages(range:number):{name:string}[];generateRaw():void;
      }};
      const b = instance('b') as typeof a;
      await pressScriptButton('a','同名按钮');
      const prefs = [a.TavernHelper.getVariables({type:'script'}),b.TavernHelper.getVariables({type:'script'})];
      a.TavernHelper.replaceVariables({private:'fixture'});
      const sameChat = b.TavernHelper.getVariables();
      active = game('second');
      const nextChat = a.TavernHelper.getVariables();
      const noModel = (() => { try { a.TavernHelper.generateRaw(); } catch { return true; } return false; })();
      const data = { type:'normal' };
      await tavernTools.apply(data);
      const bad = {...scripts[0],id:'bad',name:'坏脚本',content:"throw Error('fixture-missing-api')"};
      const broken = await mountPresetScripts({...preset,scripts:[bad]}).then(()=>false,()=>true);
      return { fixtureOrder,prefs,sameChat,nextChat,noModel,broken,body:data,rows:assistantView.snapshot().map((s:{id:string;status:string;error?:string})=>[s.id,s.status,s.error]) };
    } finally { stop(); }
  });
  expect(result.fixtureOrder).toEqual(['kept','once','kept','a','kept','once','kept','b']);
  expect(result).toMatchObject({ prefs:[{owner:'a',clicks:1},{owner:'b'}],sameChat:{private:'fixture'},nextChat:{},noModel:true,broken:true,body:{type:'normal'} });
  expect(result.body).not.toHaveProperty('tools');
  expect(result.rows.map((r:string[])=>r.slice(0,2))).toEqual([['a','已初始化'],['b','已初始化'],['disabled','已停用'],['bad','出错']]);
});

test('真实脚本保存采样后刷新生效，预览与恢复启动零传输，原生请求逐字段相同', async ({ page }) => {
  const wires: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'assistant.mock.invalid') {
      wires.push(route.request().postData()!);
      return route.fulfill({json:{choices:[{message:{content:'测试文本'},finish_reason:'stop'}]}});
    }
    return ['127.0.0.1','localhost'].includes(url.hostname) || url.protocol === 'blob:' ? route.continue() : route.abort();
  });
  async function nativeRequests() {
    await page.evaluate(async () => {
      const paths = ['/src/services/ai/client.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/services/ai/snapshot.ts'];
      const [{AiClient},{newChannel},{CredentialVault},{channelSnapshot}] = await Promise.all(paths.map(p=>import(p)));
      const ch = newChannel('openai'); ch.id='fixture-native'; ch.baseUrl='https://assistant.mock.invalid/v1';
      const vault = new CredentialVault(sessionStorage,localStorage); vault.set(ch.id,'fixture-only');
      for (const stage of ['variables','world','memory','story']) {
        await new AiClient().generate(channelSnapshot(ch,vault,stage,stage),[{role:'user',content:'同一份输入'}]);
      }
    });
  }
  await page.goto('/');
  await nativeRequests();
  const before = [...wires];
  await page.evaluate(() => localStorage.setItem('heijin.story-presets.v1',JSON.stringify({ enabled:true, selected:'peinture-1118',packages:{} })));
  await page.reload();
  const preview = await page.evaluate(async () => {
    const paths = ['/src/presets/tavern/hostState.ts','/src/tests/fixtures/game.ts','/src/ui/settings/model.ts'];
    const [{startAssistant,bindTavernPage},{game},{defaultSettings}] = await Promise.all(paths.map(p => import(p)));
    await startAssistant();
    const stop = bindTavernPage(() => ({ stage:'story',mode:'regular',userInput:'等车',state:game(),settings:defaultSettings() }),()=>{});
    const realm = document.querySelector<HTMLIFrameElement>('iframe[data-tavern-script]')!.contentWindow as Window & {getContext():{
      generate(type:string,options:unknown,dry:boolean):Promise<unknown[]>;chatCompletionSettings:{temp_openai:number};saveSettingsDebounced():void
    }};
    try {
      const c = realm.getContext();
      const result = await c.generate('normal',{},true);
      c.chatCompletionSettings.temp_openai = 0.37;
      c.saveSettingsDebounced();
      return result.length;
    } finally {stop();}
  });
  expect(preview).toBeGreaterThan(1);
  expect(wires).toEqual(before);
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('heijin.story-presets.v1')!).packages['peinture-1118']?.sampling?.temperature)).toBe(0.37);
  await page.reload();
  await page.evaluate(async () => {
    const paths = ['/src/presets/tavern/hostState.ts','/src/services/ai/runtime.ts','/src/services/ai/configuration.ts',
      '/src/tests/fixtures/game.ts','/src/ui/settings/model.ts','/src/services/ai/credentials.ts'];
    const [{startAssistant},{runStageRequest},{newChannel,defaultAiConfig},{game},{defaultSettings},{CredentialVault}] = await Promise.all(paths.map(p=>import(p)));
    await startAssistant();
    const ch = newChannel('openai'); ch.baseUrl='https://assistant.mock.invalid/v1';ch.defaultModel='fixture';
    const config = defaultAiConfig(); config.channels=[ch]; config.routes.story={channelId:ch.id,modelId:''};
    const vault = new CredentialVault(sessionStorage,localStorage);vault.set(ch.id,'fixture-only');
    // An upstream text without the game envelope must still fail Story validation.
    try { await runStageRequest({stage:'story',mode:'regular',state:game(),settings:defaultSettings(),userInput:'等车'},config,vault); }
    catch { return; }
    throw new Error('缺少王朝标签的响应被接受');
  });
  expect(wires).toHaveLength(5);
  expect(JSON.parse(wires[4])).toMatchObject({ temperature:0.37 });
  await nativeRequests();
  expect(wires.slice(5)).toEqual(before);
  await page.goto('/?safe=1');
  await expect(page.getByRole('button',{name:'设置',exact:true}).first()).toBeVisible();
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  const dialog = await settings(page);
  await expect(dialog.getByText('恢复模式：脚本已停用。')).toBeVisible();
  await dialog.getByLabel('正文预设').selectOption('');
  await page.evaluate(()=>{ Storage.prototype.setItem = () => {throw new Error('模拟存储失败');}; });
  await dialog.getByRole('button',{name:'保存预设并刷新'}).click();
  await expect(dialog.getByRole('alert')).toContainText('模拟存储失败');
  expect(wires).toHaveLength(9);
});

test('首次生成等待模块异步初始化，等待时取消及随后启动异常均保持原草稿', async ({ page }) => {
  const preset = { prompts:[],prompt_order:[{character_id:100001,order:[]}],extensions:{tavern_helper:{scripts:[
    {type:'script',name:'延迟初始化夹具',id:'gate',enabled:true,content:
      "await new Promise(resolve => { parent.finishFixtureInit = resolve; }); throw Error('fixture-init-error');"},
  ]}} };
  let attempts = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/peinture-1118.json') && url.search.includes('raw'))
      return route.fulfill({ contentType:'text/javascript',body:'export default '+JSON.stringify(JSON.stringify(preset)) });
    if (url.hostname === 'assistant.mock.invalid') { attempts++; return route.abort(); }
    return ['localhost','127.0.0.1'].includes(url.hostname) || url.protocol === 'blob:' ? route.continue() : route.abort();
  });
  await page.addInitScript(()=>localStorage.setItem('heijin.story-presets.v1',JSON.stringify({enabled:true,selected:'peinture-1118',packages:{}})));
  await page.goto('/');
  await page.waitForFunction(() => 'finishFixtureInit' in window);
  const result = await page.evaluate(async () => {
    const paths = ['/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts',
      '/src/tests/fixtures/game.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts',
      '/src/presets/tavern/hostState.ts'];
    const [{StoryStage},{SaveRepository},{createTurnDraft},{game},{defaultSettings},{newChannel,defaultAiConfig},{CredentialVault},
      {assistantView,startAssistant}] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open();
    try {
      const state = await repo.create(game('gate-qa'));
      const draft = createTurnDraft(state.saveId,state.revision,'qa','opening','');
      await repo.saveDraft(draft,null);
      const config = defaultAiConfig(), ch = newChannel('openai');
      ch.baseUrl = 'https://assistant.mock.invalid/v1'; ch.defaultModel='fixture';config.channels=[ch];config.routes.story={channelId:ch.id,modelId:''};
      const vault = new CredentialVault(sessionStorage,localStorage);vault.set(ch.id,'fixture-only');
      const stage = new StoryStage(repo), input = {draft,config,vault,settings:defaultSettings()};
      const work = stage.generate(input).catch((e:{code:string})=>e.code);
      while (!(await navigator.locks.query()).held?.some(l=>l.name==='heijin.turn:'+state.saveId))
        await new Promise(resolve=>setTimeout(resolve,5));
      const loading = assistantView.snapshot()[0].status;
      stage.cancel();
      const cancelled = await work;
      (window as unknown as {finishFixtureInit():void}).finishFixtureInit();
      await startAssistant().catch(()=>undefined);
      const failed = await stage.generate(input).catch((e:{code:string})=>e.code);
      return {loading,cancelled,failed, error:assistantView.snapshot()[0].error,
        unchanged:(await repo.loadDraft(state.saveId)).draftRevision===draft.draftRevision,
        revision:(await repo.load(state.saveId)).revision===state.revision};
    } finally {repo.close();}
  });
  expect(result).toMatchObject({loading:'加载中',cancelled:'cancelled',failed:'configuration',unchanged:true,revision:true});
  expect(result.error).toContain('fixture-init-error');
  expect(attempts).toBe(0);
});
