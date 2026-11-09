import { expect, test } from './helpers/test';
import { openGameTools } from './helpers/gameLayout';
for(const mode of ['enter','mention'] as const)test(`Story主动${mode}无预先邀请，完整三阶段自动提交后刷新`,async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const modules=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/eventStages.ts','/src/tests/fixtures/turn.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/ui/settings/model.ts'];
    const [{SaveRepository},{stageContext},{completeDraft,submission},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault},{defaultSettings,settingsKey}]=await Promise.all(modules.map(p=>import(p)));
    const settings=defaultSettings();settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;
    for(const value of Object.values(settings.memory.summaries) as {automatic:boolean}[])value.automatic=false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));const cfg=defaultAiConfig(),ch=newChannel();ch.baseUrl='https://story-arbitration.mock.invalid/v1';ch.defaultModel='story';cfg.channels=[ch];cfg.routes.story={channelId:ch.id,modelId:'story'};cfg.routes.variables={mode:'independent',channelId:ch.id,modelId:'variables'};cfg.routes.world={mode:'independent',channelId:ch.id,modelId:'world'};saveAiConfig(localStorage,cfg);new CredentialVault(sessionStorage,localStorage).set(ch.id,'arbitration-browser-only');
    const a=stageContext();a.state.events['stage-one'].fixedEndAt='2027-03-01T00:00:00+08:00';a.state.events['stage-one'].visibility='hidden';
    const repo=await SaveRepository.open();try{await repo.create(a.state);const ready=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:{worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]}});await repo.commitTurn(submission(ready,''));}finally{repo.close();}
  });
  const calls:string[]=[],stop='2027-02-10T12:00:00+08:00',end='2027-04-01T00:00:00+08:00';
  await page.route('https://story-arbitration.mock.invalid/**',async route=>{
    const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);const messages=body.messages.map((m:{content:string})=>m.content).join('\n'),match=messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);if(!match)throw Error('missing context');const ctx=JSON.parse(match[1]);let text:string;
    if(stage==='story'){
      expect(messages).toContain('Step 12｜世界事件与主角入场裁定');expect(ctx.EVENT_ENTRIES).toHaveLength(0);expect(ctx.EVENT_NARRATION_INDEX.some((e:{eventId:string})=>e.eventId==='stage-one')).toBe(true);
      const guide=[{group:'time',subjectHint:mode==='enter'?'time:pause':'time:end',observedFact:mode==='enter'?stop:end},{group:'event',observedFact:mode==='enter'?'主角实际介入核查并结束阶段':'主角仅从正式通知获知消息，不参与',eventNarration:{eventId:'stage-one',mode,at:stop}}];
      text=`<thinking>按正式背景裁定接触方式。</thinking><正文>【旁白】你接到了资料室的电话。\n【同事】“这里有新的核查情况。”</正文><短期记忆>本轮接触到资料消息。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
    } else if(stage==='variables')text='<thinking>仅落实所选正文。</thinking><说明>本轮变化。</说明><命令>'+(mode==='enter'?`set events[stage-one].sceneState = ${JSON.stringify({status:'resolved',resolvedAt:stop,outcome:'changed',resolutionText:'主角实际介入，阶段提前结束。'})}`:`set worldClock = ${JSON.stringify(end)}`)+'</命令>';
    else {
      const e=ctx.SAVE_STATE.events['stage-one'];expect(ctx.SAVE_STATE.worldClock).toBe(mode==='enter'?stop:end);expect(ctx.STORY_RESULT.eventNarrations[0].eventNarration.mode).toBe(mode);
      const eventCommands=mode==='enter'?[]:[{type:'SaveEvent',commandId:'background-end',evidence:'到期阶段由模型自主结案',event:{...e,status:'resolved',resolvedAt:e.fixedEndAt,outcome:'failure',resolutionText:'后台核查按真实进展未达成目标。',sourceTurnIds:[ctx.TURN_CONTEXT.turnId],continuation:{direction:'end',reason:'不需要额外承接'}}}];text=JSON.stringify({worldCommands:[],taskCommands:[],eventCommands,visibleHooks:[],unresolved:[]});
    }
    await route.fulfill({contentType:stage==='story'?'text/event-stream':'application/json',body:stage==='story'?`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });
  await page.goto('/#game/save-a');await page.reload();await openGameTools(page);await page.getByLabel('你的行动',{exact:true}).fill('跳过三个月');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('region',{name:'三阶段工作流'}).getByRole('status')).toContainText('本回合已结算');
  const load=()=>page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});
  const saved=await load();expect(saved.state.turnNumber).toBe(2);expect(saved.state.worldClock).toBe(mode==='enter'?stop:end);expect(saved.state.events['stage-one'].resolvedAt).toBe(mode==='enter'?stop:'2027-03-01T00:00:00+08:00');expect(saved.state.events['stage-one'].protagonistEntry).toBeUndefined();expect(saved.state.events['stage-one'].protagonistKnowledge).toBeUndefined();expect(calls).toEqual(['story','variables','world']);await page.reload();expect((await load()).state).toEqual(saved.state);expect(calls).toHaveLength(3);
});
