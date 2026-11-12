import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflow, workflowTrigger, openWorkflowStage, openStageCandidates } from './helpers/gameLayout';

type Mode = 'opening' | 'ready' | 'off' | 'error' | 'settled';
async function seed(page: Page, mode: Mode) {
  await page.goto('/');
  await page.evaluate(async mode => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{SaveRepository},{worldState},{completeDraft},{createTurnDraft,TurnDraftSchema,startStageAttempt},{defaultSettings,settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault}] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(), state = worldState();
    state.openingCityId = 'chongqing'; state.title = '沈砚 · 重庆'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5;
    if (mode === 'off') settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig();channel.baseUrl='https://workflow.mock.invalid/v1';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock'};saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-key');
    if (mode === 'opening') await repo.saveDraft(createTurnDraft('save-a',0,'opening','opening',''),null);
    else {
      let draft = await completeDraft(repo,{narrative:Array.from({length:60},(_,i)=>`【旁白】第${i+1}段：街灯照着长街，两人核对资料并讨论下一步安排。`).join("\n\n")});
      if (mode === 'settled') await repo.commitTurn({draft,nextAction:'',useVariableStage:true,useWorldStage:true});
      if (mode === 'off' || mode === 'error') {
        const previous = draft.draftRevision;
        draft = await repo.saveDraft(startStageAttempt(draft,['world'],{useVariableStage:true,useWorldStage:true}),previous);
        draft = TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1,world:undefined,stageStatus:{...draft.stageStatus,world:mode === 'error' ? 'failed' : 'pending'},failures:mode === 'error' ? [{stage:'world',attempt:2,storyRevision:draft.storyRevision,errorCode:'world_schema',retryable:true}] : []});
        await repo.saveDraft(draft,draft.draftRevision-1);
      }
    }
    repo.close();
  },mode);
  await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});
}

test('最终验收：指定视口长正文、候选、输入与刷新不产生请求或写档',async({page},info)=>{
 test.setTimeout(90000); // Four real viewport passes plus screenshots and reload.
 let requests=0;await page.route('https://workflow.mock.invalid/**',async route=>{requests++;await route.abort();});
 await seed(page,'ready');const before=await stored(page),desktop=info.project.name==='desktop';
 for(const width of desktop?[1440,1280,1100,901]:[390]){
  await page.setViewportSize({width,height:900});
  const input=page.getByLabel('你的行动',{exact:true});await input.fill('尚未发送的验收输入');
  await openWorkflowStage(page,'variables');
  const area=await openStageCandidates(page,'variables');
  await area.getByRole('button',{name:'主动查看完整变量候选',exact:true}).click();
  await expect(area.getByLabel('完整变量候选')).toContainText('SetWorldClock');
  if(!desktop)await page.keyboard.press('Escape');
  await page.screenshot({path:`docs/pr117-acceptance/react-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(desktop){
   const pop=page.getByRole('region',{name:'三阶段详情',exact:true}),p=(await pop.boundingBox())!,b=(await input.boundingBox())!;
   expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x+p.width).toBeLessThanOrEqual(width);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y+p.height).toBeLessThanOrEqual(b.y+1);
   await page.keyboard.press('Escape');await expect(workflowTrigger(page)).toBeFocused();
  }
  const reader=page.getByTestId('story-reader');
  expect(await reader.evaluate(el=>{el.scrollTop=0;const before=el.scrollTop;el.scrollTop=el.scrollHeight;return el.scrollTop>before;})).toBe(true);
  if(!desktop){await openWorkflow(page);await workflowTrigger(page).click();}
  await input.fill('');
 }
 expect(requests).toBe(0);expect(await stored(page)).toEqual(before);
 await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();expect(await stored(page)).toEqual(before);expect(requests).toBe(0);
});
