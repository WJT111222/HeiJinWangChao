import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { hanhaiSceneContext } from '../src/tests/fixtures/hanhaiSceneContext';
import { openGameTools } from './helpers/gameLayout';

async function seed(page: Page) {
  const a = hanhaiSceneContext();
  await page.goto('/');
  await page.evaluate(async ({state,draft}) => {
    const paths = {repo:'/src/services/storage/saveRepository.ts',drafts:'/src/domain/drafts.ts',config:'/src/services/ai/configuration.ts',vault:'/src/services/ai/credentials.ts'};
    const {SaveRepository} = await import(paths.repo), {createTurnDraft,rerollStory,TurnDraftSchema} = await import(paths.drafts);
    const {defaultAiConfig,newChannel,saveAiConfig} = await import(paths.config), {CredentialVault} = await import(paths.vault);
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://scene-contract.mock.invalid/v1'; channel.defaultModel = 'world';
    config.channels = [channel]; config.routes.story = {channelId:channel.id,modelId:'world'};
    saveAiConfig(localStorage,config); new CredentialVault(sessionStorage,localStorage).set(channel.id,'scene-contract-mock-only');
    const repo = await SaveRepository.open();
    try {
      await repo.create(state);
      const initial = createTurnDraft(state.saveId,state.revision,draft.turnId,'opening',''); await repo.saveDraft(initial,null);
      const selected = await repo.saveDraft(rerollStory(initial,draft.story),initial.draftRevision);
      await repo.saveDraft(TurnDraftSchema.parse({...selected,draftRevision:selected.draftRevision+1,variables:draft.variables,stageStatus:{...selected.stageStatus,variables:'ready'}}),selected.draftRevision);
    } finally { repo.close(); }
  },a);
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
  return a;
}
async function stored(page: Page) {
  return page.evaluate(async () => { const path='/src/services/storage/saveRepository.ts';const {SaveRepository}=await import(path);const repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();} });
}
test('自然现场记录与JSON围栏：候选自动结算，原文保留围栏，刷新不重新请求', async ({page}) => {
  const a=await seed(page), text=`\`\`\`json\n${JSON.stringify(a.response,null,2)}\n\`\`\``;let calls=0;
  await page.route('https://scene-contract.mock.invalid/**',async route=>{calls++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});});
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  const saved=await stored(page);expect(saved.state.events.event_hanhai_lens_extortion.status).toBe('active');expect(saved.state.economy).toEqual(a.state.economy);expect(saved.state.npc).toEqual(a.state.npc);
  await page.getByText('查看三阶段模型完整原文与执行结果',{exact:true}).click();await page.getByText('动态世界模型原文',{exact:true}).click();
  expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(text);
  await page.reload();expect(await stored(page)).toEqual(saved);expect(calls).toBe(1);
});
test('无效人物引用保留失败原文和上游；明确恢复只请求World并结算', async ({page}) => {
  const a=await seed(page), good=JSON.stringify(a.response);a.response.eventCommands[0].event.actorRefs[0].id='unknown-actor';
  const bad=`\`\`\`json\n${JSON.stringify(a.response,null,2)}\n\`\`\``;let calls=0;
  await page.route('https://scene-contract.mock.invalid/**',async route=>{calls++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:calls===1?bad:good},finish_reason:'stop'}]})});});
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect(page.getByTestId('runtime-log')).toContainText('actor_permission');
  const failed=await stored(page);expect(failed.state).toEqual(a.state);expect(failed.draft.variables.validation).toBe('validated');expect(failed.draft.story.narrative).toBe(a.draft.story!.narrative);
  await page.getByText('查看三阶段模型完整原文与执行结果',{exact:true}).click();await page.getByText('动态世界模型原文 · 未通过验收',{exact:true}).click();
  expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(bad);
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);expect(calls).toBe(2);
});
