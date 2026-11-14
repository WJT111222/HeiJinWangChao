import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { choose, selected } from './helpers/select';
import { backToList, follow, openAiSettings, openChannel, saveAi } from './helpers/aiSettings';

const tasks = [['variables', '变量管理'], ['world', '动态世界'], ['memory', '记忆维护']] as const;
const settingsOf = (page: Page) => page.getByRole('dialog', { name: '设置', exact: true });
// 打开 AI 连接（手机端先进分类菜单）；手机端停在渠道列表（各阶段模型在列表页）。
const open = async (page: Page) => { await openAiSettings(page); await backToList(settingsOf(page)); };
const close = (page: Page) => page.getByRole('dialog', {name:'设置',exact:true}).getByRole('button', { name: '关闭资料界面', exact: true }).click();
const followButton = (page: Page, label: string) => settingsOf(page).getByRole('group', { name: `${label}模型来源`, exact: true }).getByRole('button', { name: '跟随正文', exact: true });
const following = (page: Page, label: string, value = true) => expect(followButton(page, label)).toHaveAttribute('aria-pressed', String(value));
const setFollow = (page: Page, label: string, value: boolean) => follow(settingsOf(page), label, value);
const raw = (page: Page) => page.evaluate(() => localStorage.getItem('heijin.ai.v1'));
const save = (page: Page) => saveAi(settingsOf(page));
// 切换设置分类：电脑端点侧栏；手机端先「‹ 设置」返回分类菜单（有未保存修改时这里就会提示）。
async function leave(page: Page, name: string) {
  const back = settingsOf(page).getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  else await settingsOf(page).getByRole('button', { name, exact: true }).click();
}
async function category(page: Page, name: string) {
  const back = settingsOf(page).getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  await settingsOf(page).getByRole('button', { name, exact: true }).click();
}
const saveBar = (page: Page) => settingsOf(page).locator('.ai-save-bar');
async function seed(page: Page, independent = true) {
  const posts: {host:string;model:string}[] = [];
  await page.route('https://**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if(!url.hostname.endsWith('.mock.invalid')) {await route.abort();throw Error('Unexpected external request');}
    if(request.method()==='GET') {await route.fulfill({json:{data:[]}});return;}
    const model=request.postDataJSON().model;posts.push({host:url.hostname,model});
    const text=model==='variables-model'?'<thinking>没有新增变化。</thinking><说明>无变化。</说明><命令></命令>'
      :model==='world-model'?JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]})
      :'<thinking>保持场景连续。</thinking><正文>【旁白】主角观察街边的行人。</正文><短期记忆>观察街边行人。</短期记忆><变量规划>[]</变量规划>';
    await route.fulfill({json:{choices:[{message:{content:text},finish_reason:'stop'}]}});
  });
  await page.goto('/');
  await page.evaluate(async independent=>{
    const cp='/src/services/ai/configuration.ts',vp='/src/services/ai/credentials.ts';
    const {defaultAiConfig,newChannel,saveAiConfig}=await import(cp),{CredentialVault}=await import(vp),config=defaultAiConfig();
    config.channels=['story','variables','world','memory'].map(id=>({...newChannel(),id,name:`${id}渠道`,baseUrl:`https://${id}.mock.invalid/v1`,defaultModel:`${id}-default`}));
    config.routes.story={channelId:'story',modelId:'story-model'};
    if(independent) for(const stage of ['variables','world','memory']) config.routes[stage]={mode:'independent',channelId:stage,modelId:`${stage}-model`};
    saveAiConfig(localStorage,config);
    const vault=new CredentialVault(sessionStorage,localStorage);
    for(const channel of config.channels)vault.set(channel.id,'mock-route-secret');
  },independent);
  await page.reload();await open(page);return posts;
}

test('三阶段独立选择在启用跟随、保存和刷新后仍能恢复，不被正文模型覆盖',async({page})=>{
  const posts=await seed(page);
  for(const [,label] of tasks)await setFollow(page,label,true);
  await save(page);await close(page);await page.reload();await open(page);
  for(const [id,label] of tasks){
    await following(page,label);await setFollow(page,label,false);
    await selected(page,`${label}渠道`,id);await selected(page,`${label}模型`,`${id}-model`);
  }
  await save(page);await close(page);await page.reload();await open(page);
  for(const [id,label] of tasks){await following(page,label,false);await selected(page,`${label}模型`,`${id}-model`);}
  expect(posts).toHaveLength(0);
});

test('旧跟随配置没有独立选择时明确留空，不默默使用正文渠道默认模型',async({page})=>{
  const posts=await seed(page,false);
  for(const [,label] of tasks){await setFollow(page,label,false);await selected(page,`${label}渠道`,'');await selected(page,`${label}模型`,'');}
  await expect(saveBar(page).getByRole('status')).toContainText('变量管理选了「单独指定」但还没选模型');
  await expect(settingsOf(page).getByRole('button',{name:'保存 AI 配置',exact:true})).toBeDisabled();
  expect(posts).toHaveLength(0);
});

test('未保存关闭与分类切换需要明确放弃；继续编辑保留选择，保存后可直接关闭',async({page})=>{
  const posts=await seed(page,false),before=await raw(page);
  await setFollow(page,'变量管理',false);await choose(page,'变量管理渠道','variables');
  await close(page);
  const warning=page.getByRole('dialog',{name:'AI 配置尚未保存',exact:true});
  await expect(warning).toBeVisible();await warning.getByRole('button',{name:'继续编辑',exact:true}).click();
  await selected(page,'变量管理渠道','variables');expect(await raw(page)).toBe(before);
  await leave(page,'记忆');await expect(warning).toBeVisible();
  await warning.getByRole('button',{name:'继续编辑',exact:true}).click();await selected(page,'变量管理渠道','variables');
  await selected(page,'变量管理模型','variables-default');
  await save(page);await close(page);await open(page);await following(page,'变量管理',false);
  expect(posts).toHaveLength(0);
});

test('Escape、明确放弃和分类切换不会静默保存；密钥编辑同样提示且不出现在配置内',async({page})=>{
  const posts=await seed(page),before=await raw(page);
  await openChannel(settingsOf(page),'story渠道');
  await page.getByLabel('API 密钥',{exact:true}).fill('unsaved-private-mock');
  await page.keyboard.press('Escape');
  const warning=page.getByRole('dialog',{name:'AI 配置尚未保存',exact:true});await expect(warning).toBeVisible();
  await page.keyboard.press('Escape');await expect(warning).toHaveCount(0);
  await expect(page.getByLabel('API 密钥',{exact:true})).toHaveValue('unsaved-private-mock');
  await close(page);await warning.getByRole('button',{name:'放弃本次修改',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(await raw(page)).toBe(before);
  await open(page);await openChannel(settingsOf(page),'story渠道');await expect(page.getByLabel('API 密钥',{exact:true})).toHaveValue('mock-route-secret');
  await setFollow(page,'动态世界',true);
  await leave(page,'记忆');await warning.getByRole('button',{name:'放弃本次修改',exact:true}).click();
  await expect(warning).toHaveCount(0);if(page.viewportSize()!.width<700)await settingsOf(page).getByRole('button',{name:'记忆',exact:true}).click(); // 手机端放弃后回到分类菜单
  await expect(page.getByRole('heading',{name:'记忆',exact:true})).toBeVisible();
  await category(page,'AI 连接');await backToList(settingsOf(page));await following(page,'动态世界',false);
  await close(page);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await raw(page)).toBe(before);expect(before).not.toContain('mock-route-secret');expect(posts).toHaveLength(0);
});

test('名称为空时不能保存、存储失败不清除未保存保护；成功保存后才解除',async({page})=>{
  const posts=await seed(page),before=await raw(page),settings=settingsOf(page);
  await setFollow(page,'变量管理',true);await openChannel(settings,'story渠道');await page.getByLabel('渠道名称',{exact:true}).fill('');
  await expect(saveBar(page).getByRole('status')).toContainText('渠道名称不能为空');
  await expect(settings.getByRole('button',{name:'保存 AI 配置',exact:true})).toBeDisabled();
  await close(page);const warning=page.getByRole('dialog',{name:'AI 配置尚未保存',exact:true});await expect(warning).toBeVisible();
  await warning.getByRole('button',{name:'继续编辑',exact:true}).click();await page.getByLabel('渠道名称',{exact:true}).fill('story渠道');
  await page.evaluate(()=>{const original=Storage.prototype.setItem;let failed=false;Storage.prototype.setItem=function(k,v){if(k==='heijin.ai.v1'&&!failed){failed=true;throw new DOMException('mock','QuotaExceededError');}return original.call(this,k,v);};});
  await settings.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
  await expect(saveBar(page).getByRole('status')).toContainText('保存失败，请检查浏览器存储权限或空间后重试。');expect(await raw(page)).toBe(before);
  await close(page);await expect(warning).toBeVisible();await warning.getByRole('button',{name:'继续编辑',exact:true}).click();
  await save(page);await close(page);await expect(page.getByRole('dialog')).toHaveCount(0);
  await open(page);await following(page,'变量管理');await setFollow(page,'变量管理',false);
  await selected(page,'变量管理渠道','variables');await selected(page,'变量管理模型','variables-model');expect(posts).toHaveLength(0);
});

test('恢复后四路真实Mock请求使用各自渠道模型，默认模型及旧配置不变',async({page})=>{
  const posts=await seed(page);
  for(const [,label] of tasks)await setFollow(page,label,true);await save(page);await close(page);await page.reload();await open(page);
  for(const [,label] of tasks)await setFollow(page,label,false);await save(page);
  const result=await page.evaluate(async()=>{
    const cp='/src/services/ai/configuration.ts',vp='/src/services/ai/credentials.ts',rp='/src/services/ai/runtime.ts',fp='/src/tests/fixtures/world.ts',sp='/src/ui/settings/model.ts',ap='/src/services/ai/client.ts',sn='/src/services/ai/snapshot.ts';
    const {readAiConfig}=await import(cp),{CredentialVault}=await import(vp),{runStageRequest}=await import(rp),{worldState,worldDraft}=await import(fp),{defaultSettings}=await import(sp),{AiClient}=await import(ap),{requestSnapshot}=await import(sn);
    const config=readAiConfig(localStorage),vault=new CredentialVault(sessionStorage,localStorage),settings=defaultSettings(),state=worldState(),before=JSON.stringify(state);
    settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;
    for(const stage of ['story','variables','world'])await runStageRequest({stage,mode:'opening',state,draft:worldDraft(true,'opening'),settings,userInput:'观察'},config,vault,{stream:false});
    await new AiClient().generate(requestSnapshot(config,'memory',vault),[{role:'user',content:'验证Mock路由'}],{stream:false});
    return {unchanged:before===JSON.stringify(state),models:config.channels.map((c:{defaultModel:string})=>c.defaultModel)};
  });
  expect(result).toEqual({unchanged:true,models:['story-default','variables-default','world-default','memory-default']});
  expect(posts).toEqual(['story','variables','world','memory'].map(id=>({host:`${id}.mock.invalid`,model:`${id}-model`})));
});

test('保存栏在长路由页面可触达且无横向溢出，窄屏也能保存并恢复选择',async({page},info)=>{
  const posts=await seed(page);await setFollow(page,'记忆维护',true);
  const saveButton=page.getByRole('button',{name:'保存 AI 配置',exact:true});
  await expect(saveButton).toBeInViewport();await expect(saveBar(page).getByText(/有 1 处修改尚未保存/)).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('ai-route-save-bar.png')});await save(page);await close(page);await open(page);
  await setFollow(page,'记忆维护',false);await selected(page,'记忆维护渠道','memory');expect(posts).toHaveLength(0);
});

test('删除单独指定用的渠道后该阶段改回跟随正文，其他渠道和选择不受影响',async({page})=>{
  const posts=await seed(page),settings=settingsOf(page);await openChannel(settings,'variables渠道');
  await settings.getByRole('button',{name:'删除渠道',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'删除「variables渠道」？',exact:true})).toContainText('它正被「变量」使用');
  await page.getByRole('button',{name:'确认删除渠道',exact:true}).click();
  await backToList(settings);await following(page,'变量管理');
  await selected(page,'动态世界模型','world-model');await selected(page,'记忆维护模型','memory-model');
  await save(page);await close(page);await page.reload();await open(page);await following(page,'变量管理');
  await setFollow(page,'变量管理',false);await selected(page,'变量管理渠道','');
  await selected(page,'动态世界模型','world-model');await selected(page,'记忆维护模型','memory-model');
  await expect(settings.getByRole('button',{name:/^编辑渠道：/})).toHaveCount(3);
  expect(posts).toHaveLength(0);
});
