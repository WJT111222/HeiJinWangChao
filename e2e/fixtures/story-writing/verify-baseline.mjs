// Run from the PR checkout. The argument is a clean, installed V10 worktree.
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(process.argv[2] ?? '.');
const revision = execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(revision,'f6ca1ca8e961652ea8cdb8a490e3e8d653cd0482');
execFileSync('git',['-C',root,'diff','--quiet','HEAD','--']);
const server = await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  for (const mode of ['native','preset']) {
    const fixture = JSON.parse(await readFile(new URL('./v10-' + mode + '.json',import.meta.url),'utf8'));
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const calls = [];
      await page.route('**/*',async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'review.mock.invalid')
          return url.origin === origin || url.protocol === 'blob:' ? route.continue() : route.abort();
        const body = route.request().postDataJSON(), tools = (body.tools ?? []).map(t => t.function.name);
        calls.push({tools,continuation:JSON.stringify(body).includes('【续写】')});
        const text = fixture.draft.storyPartial.text;
        const message = tools.includes('actual_content') ? {tool_calls:[{id:'delivery',type:'function',
          function:{name:'actual_content',arguments:JSON.stringify({content:text})}}]} : {content:text};
        await route.fulfill({json:{choices:[{message,finish_reason:message.tool_calls ? 'tool_calls' : 'stop'}]}});
      });
      const origin = new URL(server.resolvedUrls.local[0]).origin;
      await page.goto(origin);
      if (mode === 'preset') {
        await page.evaluate(async () => {
          const {savePresetSettings} = await import('/src/presets/settings.ts');
          savePresetSettings({enabled:true,selected:'peinture-1118',packages:{}});
        });
        await page.reload();
      }
      const result = await page.evaluate(async () => {
        const [{SaveRepository},{talentPromptInput},{createTurnDraft},{StoryStage},{newChannel,defaultAiConfig},{CredentialVault}]
          = await Promise.all(['/src/services/storage/saveRepository.ts','/src/tests/fixtures/talentPrompt.ts','/src/domain/drafts.ts',
            '/src/workflows/storyStage.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'].map(p=>import(p)));
        const {state,settings,userInput} = talentPromptInput('story','regular');
        Object.assign(settings.runtime,{streamStory:false,useVariableStage:false,useWorldStage:false});
        Object.assign(settings.prompts,{minNarrativeChars:100,maxNarrativeChars:1000,actionOptions:false});
        const repo = await SaveRepository.open(), stage = new StoryStage(repo);
        try {
          const pack = {state,draft:createTurnDraft(state.saveId,state.revision,'review-train','regular',userInput,false,false)};
          await repo.importBackup(pack,(await repo.compareBackup(pack)).confirmation);
          const config = defaultAiConfig(), ch = newChannel('openai');
          ch.baseUrl='https://review.mock.invalid/v1'; ch.defaultModel='mock';
          config.channels=[ch]; config.routes.story={channelId:ch.id,modelId:''};
          const vault=new CredentialVault(globalThis.sessionStorage,globalThis.localStorage); vault.set(ch.id,'fixture-only');
          try { await stage.generate({draft:await repo.loadDraft(state.saveId),settings,config,vault,onFailureSaved:()=>{}}); }
          catch (err) { if (err.details?.storyRule !== 'tag_unclosed') throw err; }
          return await repo.loadDraft(state.saveId);
        } finally { stage.dispose(); repo.close(); }
      });
      assert.deepEqual(calls,[fixture.wire]);
      assert.deepEqual(result,fixture.draft);
      log(mode, revision, 'V10 draft and upstream request verified');
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.close(); }
