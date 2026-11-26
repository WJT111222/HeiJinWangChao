import { stageFixtureReply } from '../src/tests/fixtures/variableReply';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { correctPlace, isolationNpcIds, locationIsolationCommands, wrapUpdates, wrongPlace } from '../src/tests/fixtures/locationIsolation';
import { openGameTools, openStageSwitches, openWorkflowDiagnostics } from './helpers/gameLayout';

async function seed(page: Page, notification: boolean | 'legacy' | 'legacy-decision' | 'partial' | 'location-isolation' = false, streamWorld = false) {
  await page.goto('/');
  return page.evaluate(async ({ notification, streamWorld }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/issue194.ts',
      '/src/tests/fixtures/eventStages.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { issue194 }, { stageCommand }, { defaultAiConfig, newChannel, saveAiConfig },
      { CredentialVault }, { defaultSettings, settingsKey }, { createTurnDraft }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings(); settings.runtime.useEntityStage = notification === 'location-isolation';
    settings.prompts.minNarrativeChars = 1;
    settings.prompts.actionOptions = false;
    if (notification === 'partial' || notification === 'location-isolation') settings.runtime.streamWorld = streamWorld;
    for (const value of Object.values(settings.memory.summaries) as { automatic: boolean }[]) value.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel();
    channel.baseUrl = 'https://event-entry-194.mock.invalid/v1';
    channel.defaultModel = 'entry-handoff-mock';
    channel.compatibility.jsonMode = true;
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.entities = { mode: 'independent', channelId: channel.id, modelId: 'entities' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'event-entry-mock-only');
    const { state, draft, response, successor, terminal } = issue194();
    if (notification === 'location-isolation') {
      const fixturePath = '/src/tests/fixtures/locationIsolation.ts';
      const { locationsForIsolation } = await import(fixturePath);
      Object.assign(state, locationsForIsolation().state);
    }
    if (notification === true) {
      const event = state.events['handoff-source'];
      const cue = '汇报三家分店谈判的结果，无需回应。';
      event.entryIntent = 'notification';
      event.protagonistEntry.cue = cue;
      event.continuation.entry.cue = cue;
      response.eventCommands = [stageCommand({ ...terminal, entryIntent: 'notification' })];
    }
    if (notification === 'legacy' || notification === 'legacy-decision') {
      const event = state.events['handoff-source'];
      const cue = notification === 'legacy' ? '通过语音汇报三家分店的谈判结果。' : '请问你是否批准追加投资？';
      event.protagonistEntry.cue = cue;
      event.continuation.entry.cue = cue;
      draft.stageStatus.world = 'failed';
      draft.failures.push({stage:'world',attempt:1,storyRevision:draft.storyRevision,errorCode:'invalid_output',retryable:false});
      state.events['later-review'] = {...event,id:'later-review',title:'另一条未处理入场',
        fixedEndAt:'2026-05-17T15:00:00+08:00',entryIntent:'decision',
        protagonistEntry:{...event.protagonistEntry,id:'later-entry',cue:'是否批准明天的计划？'}};
    }
    const repo = await SaveRepository.open();
    try {
      const entry = { state, draft: notification === true || notification === 'partial' || notification === 'location-isolation'
        ? createTurnDraft(state.saveId, state.revision, draft.turnId, 'regular', '', true, true, settings.runtime.useEntityStage) : draft };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    } finally { repo.close(); }
    return { response, successor: stageCommand(successor) };
  }, { notification, streamWorld });
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}

test('World 响应截断后只重试 World，合法承接一次正式结算', async ({ page, isMobile }) => {
  const { response, successor } = await seed(page);
  const calls: { model: string; messages: { content: string }[] }[] = [];
  await page.route('https://event-entry-194.mock.invalid/**', async route => {
    expect(route.request().method()).toBe('POST');
    calls.push(route.request().postDataJSON());
    const reply = calls.length === 1 ? '{"eventCommands":[' : JSON.stringify({ ...response, eventCommands: [...response.eventCommands, successor] });
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }) });
  });
  await page.goto('/#game/save-a');
  await page.reload();
  await openGameTools(page);
  const before = await stored(page);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  const mobileDiagnostics = page.locator('dialog.mobile-diagnostics-sheet');
  if (isMobile) await expect(mobileDiagnostics).toBeVisible();
  else await openWorkflowDiagnostics(page);
  const log = isMobile
    ? mobileDiagnostics.getByRole('tabpanel', { name: /运行日志/ }).getByTestId('runtime-log')
    : page.getByRole('region', { name: '运行诊断', exact: true }).getByTestId('runtime-log');
  await expect(log).toContainText('invalid_json');
  await expect(log).not.toContainText('请核对样本清单');
  await expect(log).not.toContainText('event-entry-mock-only');
  const failed = await stored(page);
  expect(failed.state).toEqual(before.state);
  expect(failed.draft.story).toEqual(before.draft.story);
  expect(failed.draft.variables).toEqual(before.draft.variables);
  expect(failed.draft.world).toBeUndefined();
  expect(calls.map(call => call.model)).toEqual(['world']);
  const message = calls[0].messages.find(item => item.content.startsWith('<GAME_CONTEXT>'));
  const match = message?.content.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  expect(match).toBeTruthy();
  expect(JSON.parse(match![1]).EVENT_SCHEDULE.due).toEqual([expect.objectContaining({
    eventId: 'handoff-source', fixedEndAt: '2026-05-17T14:00:00+08:00',
    entryHandoff: { status: 'presented', channel: '电话', cue: '请核对样本清单', locationId: 'chongqing' },
  })]);

  if (isMobile) {
    await mobileDiagnostics.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    await expect(mobileDiagnostics).not.toBeVisible();
  }
  await openStageSwitches(page);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber + 1);
  const saved = await stored(page);
  expect(saved.state.revision).toBe(before.state.revision + 1);
  expect(saved.state.events['handoff-source']).toMatchObject({
    status: 'resolved', resolvedAt: '2026-05-17T14:00:00+08:00', protagonistEntry: { status: 'invalidated' },
  });
  expect(saved.state.events['handoff-next'].protagonistEntry).toEqual({
    ...before.state.events['handoff-source'].protagonistEntry, id: expect.stringMatching(/^stage-entry:\d+$/),
  });
  expect(saved.state.protagonist).toEqual(before.state.protagonist);
  await page.reload();
  expect((await stored(page)).state).toEqual(saved.state);
  expect(calls.map(call => call.model)).toEqual(['world', 'world']);
});

test('工作结果纯通知从 Story 收悉走完整三阶段、刷新和撤回', async ({ page }) => {
  const { response } = await seed(page, true);
  const calls: string[] = [];
  await page.route('https://event-entry-194.mock.invalid/**', async route => {
    expect(route.request().method()).toBe('POST');
    const { model, messages } = route.request().postDataJSON();
    calls.push(model);
    const wire = messages.find((message: {content: string}) => message.content.startsWith('<GAME_CONTEXT>')).content;
    const context = JSON.parse(wire.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)[1]);
    const evidence = '主角听完语音，收悉三家分店的谈判结果。';
    const receipt = { eventId:'handoff-source', entryId:'entry:1:1', action:'acknowledged' };
    if (model === 'story') {
      expect(context.EVENT_PARTICIPATION).toContainEqual({
        eventId:receipt.eventId, entryId:receipt.entryId, status:'presented', entryIntent:'notification',
      });
      const guide = [{group:'event', observedFact:'收悉工作汇报',textEvidence:evidence,eventInteraction:receipt}];
      const reply = `<thinking>按玩家行动听取工作汇报。</thinking><正文>十分钟后，${evidence}</正文><短期记忆>主角已经收悉三家分店的谈判汇报。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
      await route.fulfill({contentType:'text/event-stream',
        body:`data: ${JSON.stringify({choices:[{delta:{content:reply}}]})}

data: [DONE]

`});
      return;
    }
    let text: string;
    if (model === 'variables') {
      expect(context.STORY_RESULT.variableGuide[0].eventInteraction).toEqual(receipt);
      text = '<thinking>只落实本幕经过的时间。</thinking><说明>工作汇报收悉由程序处理。</说明><命令>set worldClock = "2026-05-17T14:00:00+08:00"</命令>';
    } else {
      expect(model).toBe('world');
      expect(context.SAVE_STATE.events['handoff-source']).toMatchObject({
        status:'active', entryIntent:'notification', protagonistEntry:{status:'acknowledged', textEvidence:evidence},
      });
      const due = context.EVENT_SCHEDULE.due.find((item: {eventId: string}) => item.eventId === 'handoff-source');
      expect(due).toMatchObject({fixedEndAt:'2026-05-17T14:00:00+08:00'});
      expect(due).not.toHaveProperty('entryHandoff');
      expect(response.eventCommands).toHaveLength(1);
      text = JSON.stringify(response);
    }
    await route.fulfill({contentType:'application/json',
      body:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });

  await page.goto('/#game/save-a');
  await page.reload();
  const before = await stored(page);
  await page.getByLabel('你的行动', { exact:true }).fill('听完这段谈判结果汇报');
  await page.getByRole('button', { name:'发送', exact:true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber + 1);
  const saved = (await stored(page)).state;
  expect(saved.revision).toBe(before.state.revision + 1);
  expect(saved.events['handoff-source']).toMatchObject({
    status:'resolved', resolvedAt:'2026-05-17T14:00:00+08:00', continuation:{direction:'end'},
    protagonistEntry:{status:'acknowledged',handledTurnId:saved.journal.at(-1).turnId},
  });
  expect(saved.protagonist).toEqual(before.state.protagonist);
  expect(saved.economy).toEqual(before.state.economy);
  expect(Object.keys(saved.events)).toEqual(Object.keys(before.state.events));
  expect(calls).toEqual(['story','variables','world']);

  await page.reload();
  await expect(page.getByRole('button', { name:'撤回（1）',exact:true })).toBeVisible();
  expect((await stored(page)).state).toEqual(saved);
  await page.getByRole('button', { name:'撤回（1）',exact:true }).click();
  await page.getByRole('button', { name:'确认撤回',exact:true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber);
  const restored = (await stored(page)).state;
  expect(restored.events).toEqual(before.state.events);
  expect(restored.journal).toEqual(before.state.journal);
  expect(restored.worldClock).toBe(before.state.worldClock);
  expect(calls).toEqual(['story','variables','world']);
});

async function openRecovery(page: Page) {
  await openGameTools(page);
  await page.getByRole('button',{name:'修复旧通知回合',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'修复旧通知回合'});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('选择旧入场').selectOption('handoff-source');
  return dialog;
}
async function approveRecovery(dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByRole('checkbox',{name:/我确认这只是通知/}).check();
  await dialog.getByRole('checkbox',{name:/我选择在本幕读完或听完/}).check();
  await dialog.getByRole('button',{name:'确认重做正文'}).click();
}
async function enterLegacySave(page: Page) {
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
}

test('旧失败草稿授权单条纯通知，手动重做正文、跨页互斥、结算和撤回',async({page,isMobile},testInfo)=>{
  test.setTimeout(60_000);
  const {response} = await seed(page,'legacy');
  const calls: string[] = [];
  let unblock!: () => void;
  const held = new Promise<void>(resolve => { unblock = resolve; });
  await page.context().route('https://event-entry-194.mock.invalid/**',async route=>{
    const {model,messages} = route.request().postDataJSON();
    calls.push(model);
    const message = messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>'));
    const ctx = JSON.parse(message.content.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)[1]);
    const receipt = {eventId:'handoff-source', entryId:'entry:1:1', action:'acknowledged'};
    let text: string;
    if(model==='story'){
      expect(ctx.LEGACY_NOTIFICATION_RECOVERY).toMatchObject({eventId:receipt.eventId,entryId:receipt.entryId,
        previousStory:{narrative:expect.stringContaining('播放一段汇报语音')}});
      expect(ctx.PLAYER_ACTION).toBe('查看资料汇报');
      await held;
      const received = '主角按选择继续听完语音，收悉三家分店谈判的结果。';
      text = `<thinking>完成玩家明确选择的收悉。</thinking><正文>十分钟后，${received}</正文><短期记忆>主角听完汇报。</短期记忆><变量规划>${JSON.stringify([
        {group:'event',observedFact:received,textEvidence:received,eventInteraction:receipt},
      ])}</变量规划>`;
    } else if(model==='variables'){
      expect(ctx.STORY_RESULT.variableGuide[0].eventInteraction).toEqual(receipt);
      text = '<thinking>记录本轮时间经过。</thinking><说明>收悉由程序应用。</说明><命令>set worldClock = "2026-05-17T14:00:00+08:00"</命令>';
    } else {
      expect(model).toBe('world');
      expect(ctx.SAVE_STATE.events['handoff-source']).toMatchObject({status:'active',
        protagonistEntry:{status:'acknowledged',recoverySource:'player-confirmed-legacy-notification'}});
      expect(ctx.SAVE_STATE.events['handoff-source']).not.toHaveProperty('entryIntent');
      const due = ctx.EVENT_SCHEDULE.due.find((item:{eventId:string})=>item.eventId===receipt.eventId);
      expect(due).not.toHaveProperty('entryHandoff');
      text = JSON.stringify(response);
    }
    await route.fulfill(model==='story' ? {contentType:'text/event-stream',
      body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`}
      : {contentType:'application/json',body:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });
  await enterLegacySave(page);
  const before = await stored(page);
  const dialog = await openRecovery(page);
  await dialog.getByText('查看或复制原正文').click();
  await expect(dialog.getByLabel('原正文')).toHaveValue(before.draft.story.narrative);
  await page.screenshot({path:testInfo.outputPath('legacy-notification-confirmation.png')});
  const duplicate = isMobile ? undefined : await page.context().newPage();
  try {
    const duplicateDialog = duplicate ? (await enterLegacySave(duplicate), await openRecovery(duplicate)) : undefined;
    await approveRecovery(dialog);
    await expect.poll(()=>[...calls]).toEqual(['story']);
    expect(await stored(page)).toEqual(before);
    if(duplicate && duplicateDialog){
      await approveRecovery(duplicateDialog);
      await expect(duplicate.getByText(/此存档已有阶段请求/).first()).toBeVisible();
      expect(calls).toEqual(['story']);
    }
  } finally {
    unblock();
    await duplicate?.close();
  }
  await expect.poll(async()=>(await stored(page)).draft.storyRevision).toBe(before.draft.storyRevision+1);
  const recovered = await stored(page);
  expect(recovered.state).toEqual(before.state);
  expect(recovered.draft.userInput).toBe(before.draft.userInput);
  expect(recovered.draft.variables).toBeUndefined();
  expect(recovered.draft.world).toBeUndefined();
  expect(recovered.draft.legacyNotificationRecovery).toMatchObject({eventId:'handoff-source',entryId:'entry:1:1'});
  expect(calls).toEqual(['story']);
  await page.reload();
  await openGameTools(page);
  expect(await stored(page)).toEqual(recovered);
  await expect(page.getByText('修复正文已保存。可继续未完成阶段验证收悉并结算。')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('legacy-notification-recovered.png')});
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(before.state.turnNumber+1);
  const saved = (await stored(page)).state;
  expect(saved.revision).toBe(before.state.revision+1);
  expect(saved.events['handoff-source']).toMatchObject({
    status:'resolved',resolvedAt:'2026-05-17T14:00:00+08:00',
    protagonistEntry:{status:'acknowledged',recoverySource:'player-confirmed-legacy-notification'},
  });
  expect(saved.events['handoff-source']).not.toHaveProperty('entryIntent');
  expect(saved.events['later-review']).toEqual(before.state.events['later-review']);
  expect(Object.keys(saved.events)).toEqual(Object.keys(before.state.events));
  expect(saved).toMatchObject({economy:before.state.economy,protagonist:before.state.protagonist,npc:before.state.npc,
    tasks:before.state.tasks,organizations:before.state.organizations});
  await page.reload();
  await expect(page.getByRole('button',{name:'撤回（1）',exact:true})).toBeVisible();
  expect((await stored(page)).state).toEqual(saved);
  await page.getByRole('button',{name:'撤回（1）',exact:true}).click();
  await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(before.state.turnNumber);
  expect((await stored(page)).state.events).toEqual(before.state.events);
  expect(calls).toEqual(['story','variables','world']);
});

test('关闭或放弃恢复零请求，待决不确认、生成失败、取消或刷新保留旧草稿',async({page,isMobile})=>{
  test.setTimeout(60_000);
  await seed(page,'legacy-decision');
  let attempts = 0;
  let unblock!: () => void;
  const held = new Promise<void>(resolve=>{ unblock=resolve; });
  await page.route('https://event-entry-194.mock.invalid/**',async route=>{
    expect(route.request().postDataJSON().model).toBe('story');
    attempts++;
    if(attempts===1){
      // The Story model sees a pending decision and returns no notice acknowledgment.
      const text = '<thinking>这是等待批准的请求。</thinking><正文>主角阅读了追加投资申请，仍未作出决定。</正文><短期记忆>投资申请仍待决定。</短期记忆><变量规划>[]</变量规划>';
      await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`});
    } else {
      await held;
      await route.abort().catch(()=>undefined);
    }
  });
  await enterLegacySave(page);
  const before = await stored(page);
  let dialog = await openRecovery(page);
  await expect(dialog.getByText('请问你是否批准追加投资？')).toBeVisible();
  await dialog.getByRole('checkbox',{name:/我选择在本幕读完或听完/}).check();
  await expect(dialog.getByRole('button',{name:'确认重做正文'})).toBeDisabled();
  await dialog.getByRole('button',{name:'关闭资料界面'}).click();
  dialog = await openRecovery(page);
  await dialog.getByRole('button',{name:'放弃修复'}).click();
  expect(attempts).toBe(0);
  expect(await stored(page)).toEqual(before);

  dialog = await openRecovery(page);
  await approveRecovery(dialog);
  await expect.poll(()=>attempts).toBe(1);
  if(isMobile){
    const diagnostics = page.locator('dialog.mobile-diagnostics-sheet');
    await expect(diagnostics).toBeVisible();
    await diagnostics.getByRole('button',{name:'关闭资料界面'}).click();
  }
  await expect(page.getByText(/原草稿已保留/).first()).toBeVisible();
  expect(await stored(page)).toEqual(before);
  dialog = await openRecovery(page);
  await approveRecovery(dialog);
  await expect.poll(()=>attempts).toBe(2);
  try {
    await page.getByRole('button',{name:'取消生成',exact:true}).click();
    await expect(page.getByText('请求已取消，已保存的正文草稿保持不变。').first()).toBeVisible();
    expect(await stored(page)).toEqual(before);
    dialog = await openRecovery(page);
    await approveRecovery(dialog);
    await expect.poll(()=>attempts).toBe(3);
    await page.reload();
    await expect(page.locator('.game-layout')).toBeVisible();
    expect(await stored(page)).toEqual(before);
    await openRecovery(page);
    expect(attempts).toBe(3);
  } finally { unblock(); }
});

test('局部容错：两个阶段各自跳过，保留到期入场、重载并在下一轮结案', async ({ page, isMobile }, info) => {
  const {response, successor}=await seed(page,'partial',isMobile);
  const calls: string[] = [];
  let worldCount=0;
  await page.route('https://event-entry-194.mock.invalid/**',async route=>{
    expect(route.request().method()).toBe('POST');
    const request=route.request().postDataJSON();
    const model: string=request.model;
    calls.push(model);
    const contextMessage=request.messages.find((message:{content:string})=>message.content.startsWith('<GAME_CONTEXT>'));
    const context=JSON.parse(contextMessage.content.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));
    let reply: string;
    if (model==='story') {
      reply='<thinking>保留已有安排。</thinking><正文>主角在店里继续核对资料，耐心等待下一步。</正文><短期记忆>主角检查资料。</短期记忆><变量规划>[]</变量规划>';
    } else if (model==='variables') {
      const commands=worldCount===0
        ? 'set worldClock = "2026-05-17T14:00:00+08:00"\nset items[missing-owner] = {"name":"合成文件","category":"document","quantity":1,"conditionText":"完好"}\nset protagonist.emotionText = "平静"'
        : 'set protagonist.emotionText = "从容"';
      reply=`<thinking>落实现场变化。</thinking><说明>待程序核对。</说明><命令>\n${commands}\n</命令>`;
    } else {
      expect(model).toBe('world');
      expect(request.response_format).toBeUndefined();
      expect(request.stream).toBe(isMobile);
      expect(request.messages.at(-1).content).toMatch(/<thinking>[\s\S]*<说明>[\s\S]*<命令>/u);
      expect(context.SAVE_STATE.items?.['missing-owner']).toBeUndefined();
      expect(context.EVENT_SCHEDULE.due).toContainEqual(expect.objectContaining({
        eventId:'handoff-source',fixedEndAt:'2026-05-17T14:00:00+08:00',entryHandoff:expect.objectContaining({status:'presented'}),
      }));
      let result: unknown;
      if (++worldCount===1) {
        expect(context.VARIABLE_RESULT.result.settlement.skipped).toMatchObject([{commandIndex:1,category:'item',field:'ownerRef'}]);
        result={...response,worldCommands:[{type:'UpdateOrganization',commandId:'org-partial-valid',organizationId:'org-stage-a',
          expectedRevision:context.BASE_SAVE_REVISION,changes:{operatingStatus:'正在核对材料'},evidence:'背景工作继续'}]};
      } else {
        const source=structuredClone(response.eventCommands[0]), followup=structuredClone(successor);
        source.event.sourceTurnIds=source.event.sourceTurnIds.filter((id:string)=>context.SAVE_STATE.events['handoff-source'].sourceTurnIds.includes(id));
        source.event.sourceTurnIds.push(context.TURN_CONTEXT.turnId);
        followup.event.sourceTurnIds=[context.TURN_CONTEXT.turnId];
        result={...response,eventCommands:[source,followup]};
      }
      reply=`<thinking>核对现有排程。</thinking><说明>后台继续处理。</说明><命令>\n${JSON.stringify(result)}\n</命令>`;
    }
    if (request.stream) {
      const pivot=Math.floor(reply.length/2);
      const fragments=[reply.slice(0,pivot),reply.slice(pivot)];
      await route.fulfill({contentType:'text/event-stream',body:fragments.map(content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`).join('')+'data: [DONE]\n\n'});
    } else {
      await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]})});
    }
  });
  await page.goto('/#game/save-a');
  await page.reload();
  const before=await stored(page);
  await page.getByLabel('你的行动',{exact:true}).fill('核对现有材料');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const summary=page.getByText('本回合已结算，跳过 2 项更新，1 个到期阶段待处理',{exact:true});
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(page.getByText(/主角与现场第 2 条.*物品.*ownerRef/u)).toBeVisible();
  await expect(page.getByText(/场外与网络第 2 条.*事件.*eventCommands\.0/u)).toBeVisible();
  const first=(await stored(page)).state;
  expect(first.turnNumber).toBe(before.state.turnNumber+1);
  expect(first.items).toEqual(before.state.items);
  expect(first.protagonist.emotionText).toBe('平静');
  expect(first.organizations['org-stage-a'].operatingStatus).toBe('正在核对材料');
  expect(first.events['handoff-source']).toEqual(before.state.events['handoff-source']);
  expect(calls).toEqual(['story','variables','world']);
  await page.screenshot({path:info.outputPath('局部容错结算.png')});
  await page.reload();
  await expect(summary).toBeVisible();
  expect((await stored(page)).state).toEqual(first);
  expect(calls).toHaveLength(3);
  await page.getByLabel('你的行动',{exact:true}).fill('继续核对材料');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=> (await stored(page)).state.turnNumber).toBe(first.turnNumber+1);
  const second=(await stored(page)).state;
  expect(second.events['handoff-source']).toMatchObject({status:'resolved',resolvedAt:'2026-05-17T14:00:00+08:00',protagonistEntry:{status:'invalidated'}});
  expect(second.events['handoff-next'].protagonistEntry.status).toBe('presented');
  expect(second.appliedCommands.filter((command:{commandId:string})=>command.commandId==='org-partial-valid')).toHaveLength(1);
  expect(calls).toEqual(['story','variables','world','story','variables','world']);
});

test('地点精确隔离：第 4 条跳过，25 条有效更新一次提交、重载与撤回', async ({ page, isMobile }, info) => {
  await seed(page,'location-isolation',isMobile);
  const calls: string[] = [];
  await page.route('https://event-entry-194.mock.invalid/**',async route=>{
    expect(route.request().method()).toBe('POST');
    const request = route.request().postDataJSON();
    calls.push(request.model);
    let reply: string;
    if (request.model === 'story') {
      reply = '<thinking>按已发生的现场写入。</thinking><正文>五分钟后，主角与同伴到达样本工作间并核对物品。</正文><短期记忆>同伴一同登记样本。</短期记忆><变量规划>[]</变量规划>';
    } else if (request.model === 'variables' || request.model === 'entities') {
      reply = stageFixtureReply(request.model, wrapUpdates(locationIsolationCommands().join('\n')));
    } else {
      expect(request.model).toBe('world');
      const message = request.messages.find((item: { content: string }) => item.content.startsWith('<GAME_CONTEXT>'));
      const context = JSON.parse(message.content.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));
      expect(context.VARIABLE_RESULT.result.settlement).toEqual({
        accepted:5, skipped:[{group:'variables',commandIndex:2,groupIndex:2,category:'item',field:'locationId',reason:'reference'}],
      });
      expect(context.ENTITY_CANDIDATE).toHaveLength(20);
      expect(context.SAVE_STATE.protagonist.locationId).toBe(correctPlace);
      reply = wrapUpdates(JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]}));
    }
    await (request.stream
      ? route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:reply}}]})}\n\ndata: [DONE]\n\n`})
      : route.fulfill({json:{choices:[{message:{content:reply},finish_reason:'stop'}]}}));
  });
  await page.goto('/#game/save-a');
  await page.reload();
  const before = (await stored(page)).state;
  await page.getByLabel('你的行动',{exact:true}).fill('登记合成样本');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const summary = page.getByText('本回合已结算，跳过 1 项更新',{exact:true});
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(page.getByText(/主角与现场第 3 条.*物品.*locationId/u)).toBeVisible();
  await expect(page.getByText(wrongPlace,{exact:false})).toHaveCount(0);
  const committed = (await stored(page)).state;
  expect(committed.turnNumber).toBe(before.turnNumber+1);
  expect(committed.protagonist.locationId).toBe(correctPlace);
  expect(committed.protagonist.currentWear).toEqual({accessoryItemIds:[]});
  expect(committed.items['item-a']).toEqual(before.items['item-a']);
  expect(committed.items['item-b'].locationId).toBe(correctPlace);
  expect(committed.npc['npc-a']).toMatchObject({ locationId:correctPlace,onScene:true,affinity:35,memories:[{text:'合成记忆 npc-a'}] });
  for (const id of isolationNpcIds)
    expect(committed.npc[id]).toMatchObject({locationId:correctPlace,onScene:true,memories:[{text:`合成记忆 ${id}`}]});
  expect(committed.locations[correctPlace]).toMatchObject({parentId:'place-parent'});
  expect(committed.locations[wrongPlace]).toBeUndefined();
  expect(calls).toEqual(['story','entities','variables','world']);
  await page.screenshot({path:info.outputPath('地点精确隔离.png')});
  await page.reload();
  await expect(summary).toBeVisible();
  expect((await stored(page)).state).toEqual(committed);
  await openGameTools(page);
  await page.getByRole('button',{name:'撤回（1）',exact:true}).click();
  await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect.poll(async ()=>(await stored(page)).state.turnNumber).toBe(before.turnNumber);
  const undone = (await stored(page)).state;
  for (const field of ['npc','items','locations','protagonist','journal'] as const) expect(undone[field]).toEqual(before[field]);
  expect(calls).toEqual(['story','entities','variables','world']);
});
