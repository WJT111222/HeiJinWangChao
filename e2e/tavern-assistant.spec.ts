import { expect, test } from './helpers/test';
import { closeWorkflowSheet, openGameTools } from './helpers/gameLayout';
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
      const previousFetch = window.fetch;
      const frameRequest = (a as unknown as {Request:typeof Request}).Request;
      const {fetchGeneration} = await import('/src/presets/tavern/fetch.ts' as string);
      let calls=0;
      let crossRealm='';
      try {
        window.fetch = (input,init)=>previousFetch(new frameRequest(new URL(String(input),location.href),init));
        const result = await fetchGeneration({path:'跨 iframe 构造器测试'},new AbortController().signal,async(req:Request)=>{
          calls++;
          return Response.json(await req.json());
        });
        crossRealm = (await result.json()).path;
      } finally { window.fetch=previousFetch; }
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
      return { calls,crossRealm,fixtureOrder,prefs,sameChat,nextChat,noModel,broken,body:data,rows:assistantView.snapshot().map((s:{id:string;status:string;error?:string})=>[s.id,s.status,s.error]) };
    } finally { stop(); }
  });
  expect(result.fixtureOrder).toEqual(['kept','once','kept','a','kept','once','kept','b']);
  expect(result).toMatchObject({ calls:1,crossRealm:'跨 iframe 构造器测试',prefs:[{owner:'a',clicks:1},{owner:'b'}],sameChat:{private:'fixture'},nextChat:{},noModel:true,broken:true,body:{type:'normal'} });
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
      const composer='/src/prompts/composer.ts', fixture='/src/tests/fixtures/talentPrompt.ts';
      const {composePrompt,composeTextVariablesPrompt}=await import(composer);
      const {talentMemoryInput,talentPromptInput}=await import(fixture);
      for (const stage of ['variables','world','memory','story']) {
        const input=stage==='memory' ? talentMemoryInput() : talentPromptInput(stage,'regular');
        const prompt=stage==='variables' ? await composeTextVariablesPrompt(input) : await composePrompt(input,null);
        await new AiClient().generate(channelSnapshot(ch,vault,stage,stage),prompt.messages);
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
  await page.evaluate(()=>localStorage.removeItem('heijin.story-presets.v1'));
  await page.reload();
  await page.evaluate(()=>localStorage.setItem('heijin.story-presets.v1','{bad'));
  await page.reload();
  const repair = await settings(page);
  await Promise.all([page.waitForNavigation(),repair.getByRole('button',{name:'重置损坏的预设配置并刷新'}).click()]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('heijin.story-presets.v1')!))).toMatchObject({enabled:false,selected:null});
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

test('正式游戏按钮跨存档生成，脚本保留普通正文并拒绝未处理工具', async ({page}) => {
  const identities: string[] = [];
  let foreign = false;
  const body = '<正文>清早下起了小雨，街上的人撑着伞。</正文><短期记忆>街上下雨</短期记忆><变量规划>[]</变量规划>';
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'assistant.mock.invalid') {
      const wire = route.request().postDataJSON();
      const description = wire.tools.find((t:{function:{name:string}})=>t.function.name==='wave_context_reference').function.description;
      identities.push(description.includes('顾乙') ? '乙' : description.includes('林舟') ? '甲' : '未知');
      const message = foreign ? {tool_calls:[{id:'foreign',type:'function',function:{name:'actual_content_extra',arguments:JSON.stringify({content:body})}}]} : {content:body};
      return route.fulfill({json:{choices:[{message,finish_reason:foreign ? 'tool_calls' : 'stop'}]}});
    }
    return ['localhost','127.0.0.1'].includes(url.hostname) || url.protocol==='blob:' ? route.continue() : route.abort();
  });
  await page.goto('/');
  await page.evaluate(async()=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/domain/drafts.ts','/src/tests/fixtures/game.ts','/src/ui/settings/model.ts',
      '/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/presets/settings.ts'];
    const [{SaveRepository},{createTurnDraft},{game},{defaultSettings,settingsKey},{newChannel,defaultAiConfig,saveAiConfig},{CredentialVault},{savePresetSettings}] =
      await Promise.all(paths.map(p=>import(p)));
    const repo = await SaveRepository.open();
    try {
      for (const [id,name] of [['assistant-a','林舟'],['assistant-b','顾乙']]) {
        const s = game(id); s.protagonist.name=name;
        await repo.create(s); await repo.saveDraft(createTurnDraft(id,s.revision,id,'opening',''),null);
      }
    } finally { repo.close(); }
    const c=defaultAiConfig(), ch=newChannel('openai'); ch.baseUrl='https://assistant.mock.invalid/v1';ch.defaultModel='fixture';
    c.channels=[ch];c.routes.story={channelId:ch.id,modelId:''};saveAiConfig(localStorage,c);
    new CredentialVault(sessionStorage,localStorage).set(ch.id,'fixture-only');
    const settings=defaultSettings();settings.runtime.streamStory=false;settings.prompts.actionOptions=false;settings.prompts.minNarrativeChars=5;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    savePresetSettings({enabled:true,selected:'peinture-1118',packages:{}});
  });
  await page.reload();
  const records = (id:string) => page.evaluate(async key=>{
    const path='/src/services/storage/saveRepository.ts', {SaveRepository}=await import(path), repo=await SaveRepository.open();
    try {return await repo.loadGame(key);} finally {repo.close();}
  },id);
  for (const id of ['assistant-a','assistant-b']) {
    await page.goto('/#game/'+id); await openGameTools(page);
    await page.getByRole('button',{name:'生成开局正文',exact:true}).click();
    await expect.poll(async()=>(await records(id)).draft?.story?.narrative).toBe('清早下起了小雨，街上的人撑着伞。');
    await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(2);
    await page.goto('/');
  }
  foreign=true;
  await page.goto('/#game/assistant-b'); await openGameTools(page);
  const current=await records('assistant-b');
  const error = await page.evaluate(async()=>{
    const paths=['/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts','/src/services/ai/configuration.ts',
      '/src/services/ai/credentials.ts','/src/ui/settings/model.ts'];
    const [{StoryStage},{SaveRepository},{readAiConfig},{CredentialVault},{defaultSettings}] = await Promise.all(paths.map(p=>import(p)));
    const repo=await SaveRepository.open(), settings=defaultSettings();
    settings.runtime.streamStory=false; settings.prompts.actionOptions=false;settings.prompts.minNarrativeChars=5;
    try {
      return await new StoryStage(repo).generate({draft:await repo.loadDraft('assistant-b'),config:readAiConfig(localStorage),
        settings,vault:new CredentialVault(sessionStorage,localStorage)}).then(()=>'',(e:{code:string})=>e.code);
    } finally {repo.close();}
  });
  expect(error).toBe('invalid_output');
  const after=await records('assistant-b');
  expect(after.draft).toEqual(current.draft);
  expect(after.state).toEqual(current.state);
  expect(identities).toEqual(['甲','乙','乙']);
  await closeWorkflowSheet(page);
  await page.locator('#player-input').fill('尚未发送的下一步行动');
  // The settings control invokes this same transition; this time a real game input is mounted.
  await Promise.all([page.waitForNavigation(),page.evaluate(async()=>{
    const path='/src/presets/tavern/hostState.ts', {switchPreset}=await import(path);
    switchPreset(null);
  })]);
  await expect(page.locator('#player-input')).toHaveValue('尚未发送的下一步行动');
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  expect(identities).toEqual(['甲','乙','乙']);
});

test('独立档案预设使用同一宿主、传输、超时、取消与草稿事务', async ({ page }) => {
  const { folioId, folioPreset } = await import('./fixtures/folioPreset');
  let synthetic = true;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    // Replace only the catalog's resource imports in this browser's test module graph.
    if (synthetic && url.pathname.endsWith('/peinture-manifest.json'))
      return route.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify({ id: folioId, title: '合成档案', version: 'test', lockedOff: [] }) });
    if (synthetic && url.pathname.endsWith('/peinture-1118.json') && url.search.includes('raw'))
      return route.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify(JSON.stringify(folioPreset)) });
    return ['localhost','127.0.0.1'].includes(url.hostname) || url.protocol === 'blob:' ? route.continue() : route.abort();
  });
  await page.addInitScript(id => {
    if (!localStorage.getItem('heijin.story-presets.v1')) {
      localStorage.setItem('heijin.story-presets.v1', JSON.stringify({ enabled: true, selected: id, packages: {
        'peinture-1118': { version: 'heijin.1', entries: {}, scripts: {}, sampling: { top_p: 0.83 } },
        [id]: { version: 'test', entries: {}, scripts: {}, sampling: { top_p: 0.37 }, scriptVariables: { 'folio-reader': { boots: 7 } } },
      } }));
    }
  }, folioId);
  await page.goto('/');
  await expect(page.locator('iframe[data-tavern-script="folio-reader"]')).toBeAttached();
  const result = await page.evaluate(async () => {
    const paths = ['/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts','/src/tests/fixtures/game.ts',
      '/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/services/ai/client.ts','/src/services/ai/stageResponses.ts'];
    const [{ StoryStage }, { SaveRepository }, { createTurnDraft }, { game }, { defaultSettings }, { newChannel, defaultAiConfig },
      { CredentialVault }, { AiClient }, { stageResponses }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      const state = await repo.create(game('folio-qa'));
      let draft = createTurnDraft(state.saveId, state.revision, 'opening-folio', 'opening', '');
      await repo.saveDraft(draft, null);
      const settings = defaultSettings(), vault = new CredentialVault(sessionStorage, localStorage);
      settings.prompts.minNarrativeChars = 5;
      settings.prompts.actionOptions = false;
      settings.runtime.timeoutSeconds = 1;
      const config = defaultAiConfig();
      const envelope = '<正文>小舟沿岸停靠，旅人合上手中的册子。</正文><短期记忆>旅人上岸</短期记忆><变量规划>[]</变量规划>';
      const content = JSON.stringify({ folio: envelope });
      let calls = 0;
      const rows = [];
      for (const mode of ['initial', 'repeat', 'timeout', 'cancel', 'malformed', 'recover']) {
        const protocol = mode === 'repeat' ? 'gemini' : 'openai';
        settings.runtime.streamStory = protocol === 'gemini' || mode === 'timeout' || mode === 'cancel';
        const channel = newChannel(protocol);
        channel.baseUrl = 'https://folio.mock.invalid/v1'; channel.defaultModel = 'fixture';
        config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
        vault.set(channel.id, 'fixture-only');
        let request = '';
        const transport = async (_url: string, init: RequestInit) => {
          calls++; request = String(init.body);
          if (mode === 'timeout' || mode === 'cancel') {
            if (mode === 'cancel') setTimeout(() => stage.cancel(), 20);
            return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(': keepalive\n\n')); } }), { headers: { 'Content-Type': 'text/event-stream' } });
          }
          if (protocol === 'gemini') {
            const frame = { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] };
            return new Response('data: ' + JSON.stringify(frame) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
          }
          return Response.json({ choices: [{ message: { content: mode === 'malformed' ? '{}' : content }, finish_reason: 'stop' }] });
        };
        const stage = new StoryStage(repo, new AiClient(transport));
        const before = JSON.stringify(draft);
        const work = stage.generate({ draft, config, vault, settings }).then(() => 'ok', (e: Error & { code?: string }) => {
          if (mode === 'initial' || !e.code) throw e;
          return e.code;
        });
        if (mode === 'initial') {
          // The actual host is loading; this wait exceeds the eventual client budget.
          await new Promise(ok => setTimeout(ok, 1150));
          window.dispatchEvent(new Event('folio-ready'));
        }
        const code = await work;
        draft = await repo.loadDraft(state.saveId);
        const record = stageResponses.getSnapshot()[0];
        rows.push({ mode, code, marker: request.includes('folio-fixture-only'), old: JSON.stringify(draft) === before,
          story: draft.story?.narrative, timeline: record.diagnostics?.tavern?.timeline, calls: record.diagnostics?.tavern?.calls });
      }
      const saved = JSON.parse(localStorage.getItem('heijin.story-presets.v1')!);
      const originalState = JSON.stringify(await repo.load(state.saveId)) === JSON.stringify(state);
      saved.selected = 'peinture-1118';
      localStorage.setItem('heijin.story-presets.v1', JSON.stringify(saved));
      return { rows, calls, packages: saved.packages, originalState };
    } finally { repo.close(); }
  });
  expect(result.rows.map(row => row.code)).toEqual(['ok', 'ok', 'timeout', 'cancelled', 'invalid_output', 'ok']);
  expect(result.rows[0].timeline.budgetStartMs).toBeGreaterThanOrEqual(1000);
  expect(result.rows[2].timeline).toMatchObject({ timeoutSeconds: 1, deadlinePhase: 'upstream_read', comments: 1 });
  expect(result.rows.map(row => row.old)).toEqual([false, false, true, true, true, false]);
  expect(result.rows.every(row => row.marker && row.calls === 1 && row.story === '小舟沿岸停靠，旅人合上手中的册子。')).toBe(true);
  expect(result.calls).toBe(6);
  expect(result.originalState).toBe(true);
  expect(result.packages[folioId].scriptVariables['folio-reader']).toEqual({ boots: 8 });
  expect(result.packages['peinture-1118']).toEqual({ version: 'heijin.1', entries: {}, scripts: {}, sampling: { top_p: 0.83 } });
  synthetic = false;
  await page.reload();
  await expect(page.locator('iframe[data-tavern-script]').first()).toBeAttached();
  await expect(page.locator('iframe[data-tavern-script="folio-reader"]')).toHaveCount(0);
});
