import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openGameTools, openStageRaw, openSettings, openWorkflowStage } from './helpers/gameLayout';
import { STORY_OUTPUT_TOOL } from '../src/services/ai/storyToolContract';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';

const key='fictional-tool-browser-key';
const narrative='【旁白】主角在街边用餐，观察来往行人。';
const story=`<thinking>仅本次原文可见的规划。</thinking><正文>${narrative}</正文><短期记忆>在街边用餐。</短期记忆><变量规划>[]</变量规划>`;
const args=JSON.stringify({content:story});
const frame=(data:unknown)=>`data: ${JSON.stringify(data)}\n\n`;
let server:Server,active:ServerResponse|undefined,baseUrl:string,calls:{model:string;tools:boolean}[];
let mode:'hold'|'mixed'|'multiple'|'incomplete'|'story-partial'|'ordering'|'sse-tail';
function write(value:unknown){
  const bytes=Buffer.from(frame(value));for(let n=0;n<bytes.length;n+=3)active!.write(bytes.subarray(n,n+3));
}
function begin(argumentsText:string){write({choices:[{delta:{tool_calls:[{index:0,id:'native-call-1',type:'function',function:{name:STORY_OUTPUT_TOOL,arguments:argumentsText}}]}}]});}
function finish(){active!.end(frame({choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}})+'data: [DONE]\n\n');}
async function stored(page:Page){return page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts';const {SaveRepository}=await import(p),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});}
async function seed(page:Page,enabled=true,storyOnly=false,protocol:'deepseek'|'openai'='deepseek'){
  await page.goto('/');await page.evaluate(async({baseUrl,key,enabled,storyOnly,protocol})=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{SaveRepository},{worldState},{createTurnDraft},{defaultSettings,settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault}]=await Promise.all(paths.map(p=>import(p)));
    const repo=await SaveRepository.open();await repo.create(worldState());await repo.saveDraft(createTurnDraft('save-a',0,'tool-browser-opening','opening',''),null);repo.close();
    const settings=defaultSettings();settings.prompts.minNarrativeChars=5;settings.prompts.actionOptions=false;
    if(storyOnly){settings.runtime.useVariableStage=false;settings.runtime.useWorldStage=false;}
    for(const summary of Object.values(settings.memory.summaries) as {automatic:boolean}[])summary.automatic=false;
    if(enabled)settings.runtime.storyToolOutput=true;else delete (settings.runtime as Partial<typeof settings.runtime>).storyToolOutput;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel=newChannel(protocol),config=defaultAiConfig();channel.baseUrl=baseUrl;config.channels=[channel];
    config.routes.story={channelId:channel.id,modelId:'story'};config.routes.variables={mode:'independent',channelId:channel.id,modelId:'variables'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};
    saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,key);
  },{baseUrl,key,enabled,storyOnly,protocol});await page.goto('/#game/save-a');await page.reload();await openGameTools(page);return stored(page);
}
async function start(page:Page){await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await expect.poll(()=>Boolean(active)).toBe(true);}
async function closeDiagnostics(page:Page){const dialog=page.getByRole('dialog',{name:'重试与变更详情',exact:true});if(await dialog.isVisible())await page.keyboard.press('Escape');}
test.beforeEach(async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.route('https://**/*',route=>route.abort());
  active=undefined;calls=[];mode='hold';
  server=createServer(async(req,res)=>{
    res.on('error',()=>undefined);res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','content-type,authorization');
    if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
    let raw='';for await(const chunk of req)raw+=String(chunk);const body=JSON.parse(raw);calls.push({model:body.model,tools:Array.isArray(body.tools)});
    if(body.model!=='story'){
      const text=body.model==='variables'?variableTextEnvelope('<说明>用餐结束。</说明><命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nadd economy.cash = -3000\n</命令>'):JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));return;
    }
    active=res;
    if (mode === 'sse-tail') {
      res.writeHead(200, {'Content-Type': 'text/html; fixture=SYNTHETIC_MIME_PARAM'}).end('<!doctype html>\n<div>SYNTHETIC_HTML_TAIL</div>');
      return;
    }
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
    if(mode==='hold')return;
    if(mode==='story-partial'){
      const content=calls.filter(c=>c.model==='story').length===1?'<正文>【旁白】雨水沿着站台落下。':'</正文><短期记忆>等待</短期记忆><变量规划>[]</变量规划>';
      begin(JSON.stringify({content}));finish();return;
    }
    if(mode==='ordering'){
      write({choices:[{delta:{reasoning_content:`SYNTHETIC_PRIVATE_THOUGHT ${key}`}}]});
      begin(args);
      write({choices:[{delta:{},finish_reason:'tool_calls'}]});
      finish();
      return;
    }
    if(mode==='incomplete'){begin('{"content":"<正文>参数没有闭合');finish();return;}
    const call={index:0,id:'native-call-1',type:'function',function:{name:STORY_OUTPUT_TOOL,arguments:args}};
    write({choices:[{delta:{...(mode==='mixed'?{content:'私密混合正文不允许直接接受。'}:{}),tool_calls:mode==='multiple'?[call,{...call,index:1,id:'native-call-2'}]:[call]}}]});finish();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('port');baseUrl=`http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});

test('旧设置默认关闭；两端开关保存刷新，打开设置不写入或请求',async({page},info)=>{
  await seed(page,false);const original=await page.evaluate(()=>localStorage.getItem('heijin.settings.v1'));
  await openSettings(page);await page.getByRole('button',{name:'运行',exact:true}).click();const toggle=page.getByRole('checkbox',{name:'正文生成 · 结构化输出（实验）',exact:true});
  await expect(toggle).not.toBeChecked();expect(await page.evaluate(()=>localStorage.getItem('heijin.settings.v1'))).toBe(original);
  await toggle.check();await page.getByRole('button',{name:'保存本地设置',exact:true}).click();await page.reload();await openSettings(page);await page.getByRole('button',{name:'运行',exact:true}).click();await expect(toggle).toBeChecked();
  await page.screenshot({path:info.outputPath('tool-settings.png')});expect(calls).toEqual([]);
});

test('真实SSE工具参数只读原文、思考脱敏、复制；严格校验后仅一次原子结算',async({page},info)=>{
  const before=await seed(page);await start(page);
  write({choices:[{delta:{reasoning_content:`公开思考与 ${key}`}}]});
  const split=args.indexOf('</thinking>');const first=args.slice(0,split);begin(first);
  await expect.poll(()=>page.evaluate(async()=>{const p='/src/services/ai/stageResponses.ts';return(await import(p)).stageResponses.getSnapshot()[0]?.text;})).toBe(first);
  expect(await page.locator('body').textContent()).not.toContain('仅本次原文可见');expect(await page.locator('body').textContent()).not.toContain(key);
  const pending=await stored(page);expect(pending.state).toEqual(before.state);expect(pending.draft?.story).toBeUndefined();expect(calls).toEqual([{model:'story',tools:true}]);
  const panel=await openStageRaw(page,'story'),box=panel.getByRole('textbox',{name:'正文模型完整原文',exact:true});
  await expect(box).toHaveAttribute('readonly','');await expect(box).toHaveValue(new RegExp('仅本次原文可见'));await expect(panel.locator('textarea')).toHaveCount(1);
  expect(await box.inputValue()).not.toContain(key);const shown=await box.inputValue();await box.focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+C');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(shown);
  expect(await stored(page)).toEqual(pending);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('tool-live-raw.png')});
  write({choices:[{delta:{tool_calls:[{index:0,function:{arguments:args.slice(split)}}]}}]});finish();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  const committed=await stored(page);expect(committed.state.revision).toBe(1);expect(committed.state.journal).toHaveLength(1);expect(committed.state.memories.short).toHaveLength(1);expect(committed.state.journal[0].story.narrative).toBe(narrative);
  expect(calls).toEqual([{model:'story',tools:true},{model:'variables',tools:false},{model:'world',tools:false}]);
  await expect(page.getByTestId('story-reader')).toContainText('主角在街边用餐');await expect(page.getByTestId('story-reader')).not.toContainText('仅本次原文可见');await expect(page.getByTestId('story-reader')).not.toContainText('{"content"');
  await page.screenshot({path:info.outputPath('tool-committed.png')});await page.reload();expect((await stored(page)).state).toEqual(committed.state);expect(calls).toHaveLength(3);
});
for(const failure of ['mixed','multiple','incomplete'] as const)test(`非法工具载体 ${failure} 整批拒绝、无下游、原文主动可查`,async({page},info)=>{
  const before=await seed(page);mode=failure;await start(page);
  await expect.poll(async()=>(await stored(page)).draft?.stageStatus.story).toBe('failed');const after=await stored(page);
  expect(after.state).toEqual(before.state);expect(after.draft?.story).toBeUndefined();expect(after.draft?.storyPartial).toBeUndefined();expect(calls).toEqual([{model:'story',tools:true}]);
  const logs=page.getByTestId('runtime-log');for(const log of await logs.all())expect(await log.textContent()).not.toContain('仅本次原文可见');
  await closeDiagnostics(page);const panel=await openStageRaw(page,'story');const box=panel.getByRole('textbox',{name:'正文模型完整原文',exact:true});await expect(box).toHaveValue(/content/);expect(await page.locator('body').textContent()).not.toContain(key);
  expect(await stored(page)).toEqual(after);await page.screenshot({path:info.outputPath(`tool-${failure}.png`)});
});
test('取消工具SSE后迟到参数不得复活候选或触发下游',async({page},info)=>{
  const before=await seed(page);await start(page);begin('{"content":"<正文>取消前收到的片段');await openWorkflowStage(page,'story');
  await page.getByRole('region',{name:'三阶段详情',exact:true}).getByRole('button',{name:'取消自动执行',exact:true}).click();
  await expect(page.getByRole('button',{name:'取消自动执行',exact:true})).toBeHidden();
  write({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'迟到片段"}'}}]}}]});finish();
  await closeDiagnostics(page);const after=await stored(page);expect(after.state).toEqual(before.state);expect(after.draft?.story).toBeUndefined();expect(after.draft?.storyPartial).toBeUndefined();expect(calls).toEqual([{model:'story',tools:true}]);
  const panel=await openStageRaw(page,'story');await expect(panel.getByRole('textbox')).not.toHaveValue(/迟到片段/);await page.screenshot({path:info.outputPath('tool-cancelled.png')});
});

test('工具载体中的Story缺尾可刷新后主动续写；原文只保留真实新参数',async({page},info)=>{
  const before=await seed(page,true,true);mode='story-partial';await start(page);
  const prefix='<正文>【旁白】雨水沿着站台落下。',tail='</正文><短期记忆>等待</短期记忆><变量规划>[]</变量规划>';
  await expect.poll(async()=>(await stored(page)).draft?.storyPartial?.text).toBe(prefix);expect((await stored(page)).state).toEqual(before.state);expect(calls).toHaveLength(1);
  await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();await closeDiagnostics(page);expect(calls).toHaveLength(1);
  await page.getByRole('button',{name:'续写正文',exact:true}).click();await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  const after=await stored(page);expect(after.state.journal[0].story.narrative).toBe('【旁白】雨水沿着站台落下。');expect(after.state.memories.short).toHaveLength(1);expect(after.state.economy).toEqual(before.state.economy);expect(after.draft?.storyPartial).toBeUndefined();expect(calls).toEqual([{model:'story',tools:true},{model:'story',tools:true}]);
  await closeDiagnostics(page);const panel=await openStageRaw(page,'story');await expect(panel.getByRole('textbox',{name:'正文模型完整原文',exact:true})).toHaveValue(JSON.stringify({content:tail}));await page.screenshot({path:info.outputPath('tool-continuation.png')});expect(await stored(page)).toEqual(after);
});

for (const failure of ['ordering', 'sse-tail'] as const) test(`两端主动下载 ${failure} 诊断，仅导出白名单元数据，刷新销毁临时记录`, async ({page}, info) => {
  const before = await seed(page, true, false, 'openai');
  mode = failure;
  await start(page);
  await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('failed');
  const after = await stored(page);
  expect(after.state).toEqual(before.state);
  expect(after.draft?.story).toBeUndefined();
  expect(after.draft?.storyPartial).toBeUndefined();
  expect(calls).toEqual([{model:'story',tools:true}]);
  await expect(page.getByRole('button', {name:'导出诊断', exact:true})).toBeHidden();
  await closeDiagnostics(page);
  const panel = await openStageRaw(page, 'story');
  const button = panel.getByRole('button', {name:'导出诊断', exact:true});
  await expect(button).toBeVisible();
  await expect(panel.getByRole('textbox', {name:'正文模型完整原文', exact:true})).toHaveCount(failure === 'ordering' ? 1 : 0);
  await page.screenshot({path:info.outputPath('diagnostic-entry.png')});
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('story-tool-diagnostics.json');
  const bytes = await readFile((await download.path())!, 'utf8');
  const summary = JSON.parse(bytes);
  expect(summary).toMatchObject({
    protocol: 'openai', model: 'story', endpointKind: 'local', requestedStream: true, observedTransport: 'sse',
    httpStatus: 200, boundary: null, timeoutSeconds: 120,
  });
  expect(summary.httpMs).toBeLessThanOrEqual(summary.firstBodyChunkMs);
  if (failure === 'ordering') {
    expect(summary).toMatchObject({
      contentType: 'event_stream', sse: {readerEof: false, failureSite: null},
      counts: {'tool-start': 1, 'tool-arguments': 1, 'tool-end': 1, 'provider-finish': 2},
      outcome: {code: 'tool_response', toolRule: 'ordering', orderingSite: 'duplicate_provider_finish'},
      stage: {status: 'failed', errorCode: 'tool_response'},
    });
    expect(summary.firstBodyChunkMs).toBeLessThanOrEqual(summary.firstSseFrameMs);
    expect(summary.firstSseFrameMs).toBeLessThanOrEqual(summary.firstArgumentsMs);
    expect(summary.lastArgumentsMs).toBeLessThanOrEqual(summary.firstProviderFinishMs);
    expect(summary.firstProviderFinishMs).toBeLessThanOrEqual(summary.totalMs);
  } else {
    expect(summary).toMatchObject({
      contentType: 'html', firstSseFrameMs: null,
      sse: {firstReadHadBytes: true, readerEof: true, failureSite: 'unrecognized_eof_tail', unrecognizedLines: 2, dataLines: 0},
      outcome: {code: 'stream_interrupted', step: 'waiting-sse-frame', frame: 0},
      stage: {status: 'failed', errorCode: 'stream_interrupted'},
    });
  }
  for (const value of [key, narrative, 'SYNTHETIC_PRIVATE_THOUGHT', '本次原文可见的规划', 'native-call-1', 'save-a',
    'tool-browser-opening', baseUrl, 'Authorization', 'GAME_CONTEXT', STORY_OUTPUT_TOOL, 'requestBody',
    'SYNTHETIC_MIME_PARAM', 'SYNTHETIC_HTML_TAIL']) expect(bytes).not.toContain(value);
  await download.saveAs(info.outputPath('redacted-export.json'));
  expect(await stored(page)).toEqual(after);
  await page.reload();
  await closeDiagnostics(page);
  await openStageRaw(page, 'story');
  await expect(button).toHaveCount(0);
  expect(calls).toHaveLength(1);
});
