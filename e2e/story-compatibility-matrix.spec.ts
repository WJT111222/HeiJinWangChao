import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { openGameTools, openStageRaw } from './helpers/gameLayout';
import { compatibilityModels, compatibilityFrames, compatibilityFrame, compatibilityJson, storyEnvelope, longNarrative, privatePlan, requestModel } from '../src/tests/fixtures/storyCompatibility';
import { variableReply } from '../src/tests/fixtures/variableReply';
import { worldDraft, worldResult } from '../src/tests/fixtures/world';
import type { Protocol } from '../src/services/ai/configuration';

let server: Server, storyResponse: ServerResponse | undefined, worldResponse: ServerResponse | undefined;
let protocol: Protocol, baseUrl: string, calls: { model: string; tool: boolean }[], remaining: Record<string, unknown>[];
const key = 'fictional-phase3-browser-key';
const thought = `公开思考：仅使用已知事实。${key}`;
const text = storyEnvelope(longNarrative);
function writeFrames(response: ServerResponse, frames: Record<string, unknown>[]) {
  for (const frame of frames) {
    const bytes = Buffer.from(compatibilityFrame(frame));
    for (let index = 0; index < bytes.length; index += 97) response.write(bytes.subarray(index, index + 97));
  }
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts'; const { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async ({ protocol, baseUrl, model, key }) => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { createTurnDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open(); await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a',0,'matrix-ui-opening','opening',''),null); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 12; settings.prompts.actionOptions = false; settings.runtime.storyToolOutput = true;
    for (const config of Object.values(settings.memory.summaries) as { automatic:boolean }[]) config.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(protocol), config = defaultAiConfig(); channel.baseUrl = baseUrl; channel.defaultModel = model; config.channels = [channel];
    config.routes.story = { channelId:channel.id,modelId:model }; config.routes.variables = { mode:'independent',channelId:channel.id,modelId:'variables' }; config.routes.world = { mode:'independent',channelId:channel.id,modelId:'world' };
    saveAiConfig(localStorage,config); new CredentialVault(sessionStorage,localStorage).set(channel.id,key);
  }, { protocol, baseUrl, model:compatibilityModels[protocol], key });
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page); return stored(page);
}
test.beforeEach(async ({ page, context }) => {
  calls=[]; remaining=[]; storyResponse=undefined; worldResponse=undefined;
  await context.grantPermissions(['clipboard-read','clipboard-write']); await page.route('https://**/*',route=>route.abort());
  server=createServer(async(req,res)=>{
    res.on('error',()=>undefined); res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','content-type,authorization,x-api-key,x-goog-api-key,anthropic-version,anthropic-dangerous-direct-browser-access');
    if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
    let raw='';for await(const chunk of req)raw+=String(chunk);const body=JSON.parse(raw),model=requestModel(protocol,req.url ?? '',body);
    calls.push({model,tool:Boolean(body.tools)});
    if(model===compatibilityModels[protocol]){
      storyResponse=res;res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
      const frames=compatibilityFrames({protocol,tool:true,stream:true,text,reasoning:thought,chunkSize:256});
      // Gemini publishes a complete functionCall value, not argument deltas.
      // Hold before that value; other protocols can expose a real partial argument.
      const cut=protocol==='anthropic'?6:protocol==='gemini'?1:3;
      writeFrames(res,frames.slice(0,cut));remaining=frames.slice(cut);return;
    }
    if(model==='world'){worldResponse=res;return;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(compatibilityJson({protocol,tool:false,stream:false,text:variableReply(worldDraft().variables!.result)})));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('missing mock port');baseUrl=`http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});

for(const selected of ['openai','deepseek','gemini','anthropic'] as const) test(`${selected} 原生工具长篇：主动原文、滚动复制、三阶段与刷新`,async({page},info)=>{
  protocol=selected;const before=await seed(page);
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await expect.poll(()=>Boolean(storyResponse)).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>{const p='/src/services/ai/stageResponses.ts';return(await import(p)).stageResponses.getSnapshot()[0]?.nativeReasoning;})).toContain('公开思考');
  expect(await page.locator('body').textContent()).not.toContain(privatePlan);expect(await page.locator('body').textContent()).not.toContain(key);
  const pending=await stored(page);expect(pending.state).toEqual(before.state);expect(pending.draft?.story).toBeUndefined();expect(calls).toEqual([{model:compatibilityModels[protocol],tool:true}]);
  const panel=await openStageRaw(page,'story'),box=panel.getByRole('textbox',{name:'正文模型完整原文',exact:true});await expect(box).toHaveAttribute('readonly','');await expect(panel.locator('textarea')).toHaveCount(1);
  writeFrames(storyResponse!,remaining);storyResponse!.end(protocol==='openai'||protocol==='deepseek'?'data: [DONE]\n\n':'');
  await expect.poll(()=>Boolean(worldResponse)).toBe(true);const candidate=await stored(page);expect(candidate.state).toEqual(before.state);expect(candidate.draft?.story?.narrative).toBe(longNarrative);expect(candidate.draft?.variables?.validation).toBe('validated');
  await openStageRaw(page,'story');
  await expect(box).toHaveValue(new RegExp('第240段'));expect((await box.inputValue()).includes(key)).toBe(false);
  await box.evaluate(el=>{el.scrollTop=el.scrollHeight;});expect(await box.evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollTop>0)).toBe(true);
  const raw=await box.inputValue();await box.focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+C');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(raw);
  expect(await stored(page)).toEqual(candidate);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${protocol}-long-raw.png`)});
  worldResponse!.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(compatibilityJson({protocol,tool:false,stream:false,text:JSON.stringify(worldResult())})));
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);const final=await stored(page);
  expect(final.state.revision).toBe(1);expect(final.state.journal).toHaveLength(1);expect(final.state.memories.short).toHaveLength(1);expect(final.state.journal[0].story.narrative).toBe(longNarrative);expect(final.state.economy.cash).toBe(7000);
  expect(calls).toEqual([{model:compatibilityModels[protocol],tool:true},{model:'variables',tool:false},{model:'world',tool:false}]);
  await expect(page.getByTestId('story-reader')).toContainText('第240段');await expect(page.getByTestId('story-reader')).not.toContainText(privatePlan);
  await page.screenshot({path:info.outputPath(`${protocol}-committed.png`)});await page.reload();expect((await stored(page)).state).toEqual(final.state);expect(calls).toHaveLength(3);
});
