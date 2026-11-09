import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openWorldArchive } from './helpers/gameLayout';

async function seed(page:Page) {
  await page.goto('/');
  await page.evaluate(async()=>{
    const p='/src/services/storage/saveRepository.ts',w='/src/tests/fixtures/world.ts',d='/src/domain/drafts.ts',c='/src/services/ai/configuration.ts',v='/src/services/ai/credentials.ts',s='/src/ui/settings/model.ts';
    const {SaveRepository}=await import(p),{worldState}=await import(w),{createTurnDraft}=await import(d),{defaultAiConfig,newChannel,saveAiConfig}=await import(c),{CredentialVault}=await import(v),{defaultSettings,settingsKey}=await import(s);
    const settings=defaultSettings();settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel=newChannel(),config=defaultAiConfig();channel.baseUrl='https://entry-feedback.mock.invalid/v1';channel.defaultModel='story';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'story'};
    config.routes.variables={mode:'independent',channelId:channel.id,modelId:'variables'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};
    saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-entry-only-key');
    const repo=await SaveRepository.open();try{const state=worldState();await repo.create(state);await repo.saveDraft(createTurnDraft('save-a',0,'entry-opening','opening',''),null);}finally{repo.close();}
  });
  await page.goto('/#game/save-a');await page.reload();await openGameTools(page);
}
const stored=(page:Page)=>page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open();try{return await r.loadGame('save-a');}finally{r.close();}});
const settled=(page:Page)=>expect(page.getByRole('region',{name:'三阶段工作流'}).getByRole('status')).toContainText('本回合已结算');
const scene='林舟与现场人物在办公室发生争执。';
const cue='值班室来电，请你说明情况。';
const refusal='林舟明确拒绝继续约谈，但调查仍可由原单位继续。';
async function mock(page:Page) {
  const calls:string[]=[],control={failWorld:false};
  await page.route('https://entry-feedback.mock.invalid/**',async route=>{
    const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
    const turn=calls.filter(s=>s==='story').length;
    const messages=body.messages.map((m:{content:string})=>m.content).join('\n'),match=messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
    if(!match)throw Error('real context missing');
    const ctx=JSON.parse(match[1]),turnId=ctx.TURN_CONTEXT?.turnId;
    const at=`2026-10-18T08:${turn===1?'05':turn===2?'15':'25'}:00+08:00`;
    const evidence=(fact:string,sources:string[],kind='derived',decision?:unknown)=>JSON.stringify({version:1,kind,at,sources,fact,rationale:'根据已发生的事实和原有工作安排处理。',...(decision?{decision}: {})});
    const blank={worldCommands:[],taskCommands:[],eventCommands:[] as unknown[],visibleHooks:[],unresolved:[]};
    let text:string;
    if(stage==='story') {
      const entry=ctx.EVENT_ENTRIES?.[0],participation=ctx.EVENT_PARTICIPATION?.[0];
      const narrative=turn===1?scene:turn===2?cue:refusal;
      const guide=turn===1?[]:[{group:'event',observedFact:'本幕实际行为',textEvidence:narrative,eventInteraction:{eventId:'contact',entryId:entry?.entryId??participation?.entryId,action:turn===2?'presented':'declined'}}];
      if(turn===2){
        expect(entry.cue).toBe(cue);
        expect(ctx.SAVE_STATE.events.contact.backgroundText).toBe('内部调查秘密'); // PR73：作者读取完整世界。
        expect(JSON.stringify(entry)).not.toContain('内部调查秘密'); // 入场提示不自动授予角色后台知识。
      }
      if(turn===3)expect(ctx.EVENT_ENTRIES).toEqual([]);
      text=`<thinking>衔接当前行动，不代玩家作选择。</thinking><正文>${narrative}</正文><短期记忆>${narrative}</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
    } else if(stage==='variables') {
      text=`<thinking>只记录本幕变化。</thinking><说明>时间经过，无其他变化。</说明><命令>set worldClock = "2026-10-18T08:${turn===1?'10':turn===2?'20':'30'}:00+08:00"</命令>`;
    } else {
      if(turn===1) {
        const common={startAt:'2026-10-18T08:00:00+08:00',linkedTaskIds:[],prerequisites:['沟通材料事项'],blockers:['部分意见尚未一致'],visibility:'hidden',impact:'significant',sourceTurnIds:[turnId]};
        blank.eventCommands=[
          {type:'SaveEvent',commandId:'record-scene',evidence:evidence(scene,['story:current'],'established'),event:{...common,id:'scene-dispute',title:scene,backgroundText:scene,goalText:scene,status:'active',estimatedEndAt:'2026-10-18T09:00:00+08:00',actorRefs:[{kind:'protagonist',id:'hero'},{kind:'npc',id:'scene'}],visibility:'known',continuation:{direction:'end',reason:'先记录争执，没有后续约定'}}},
          {type:'SaveEvent',commandId:'queue-contact',evidence:evidence('同事整理了材料。',['npc:npc-a','goal:npc-a:0']),event:{...common,id:'contact',title:'内部约谈',backgroundText:'内部调查秘密',goalText:'听取当事人意见',status:'active',estimatedEndAt:'2026-10-18T08:05:00+08:00',actorRefs:[{kind:'npc',id:'npc-a'}],continuation:{direction:'protagonist',reason:'材料清点完毕后电话联系',entry:{channel:'电话',cue}}}},
        ];
      } else if(control.failWorld) {
        control.failWorld=false;
        blank.eventCommands=[{type:'SaveEvent',commandId:'bad-actor',event:{...ctx.OFFSCREEN_STATE.events.contact,sourceTurnIds:[turnId],actorRefs:[{kind:'npc',id:'missing-npc'}]},evidence:'模型提出了一项事件更新。'}];
      } else if(turn===3) {
        const current=ctx.OFFSCREEN_STATE.events.contact;
        expect(current.protagonistEntry.status).toBe('declined');
        blank.eventCommands=[{type:'SaveEvent',commandId:'respond-refusal',event:{...current,status:'blocked',estimatedEndAt:'2026-10-19T08:00:00+08:00',continuation:{direction:'end',reason:'尊重已经发生的拒绝，原单位另行处理'}},
          evidence:evidence(refusal,['event:contact','story:current'],'derived',{targetId:'contact',status:'blocked',reason:'本次约谈已拒绝，等待原单位另行处理',result:refusal,conditionsSatisfied:false,continues:true})}];
      }
      text=JSON.stringify(blank);
    }
    await route.fulfill({contentType:stage==='story'?'text/event-stream':'application/json',body:stage==='story'
      ?`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`
      :JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });
  return {calls,control};
}

test('现场事件结算→刷新后下一幕真实入场→拒绝回写同一事件，无重复请求或入场',async({page},info)=>{
  await seed(page);const baseline=(await stored(page)).state;const server=await mock(page);
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await settled(page);
  let data=await stored(page);expect(data.state.events['scene-dispute'].status).toBe('active');expect(data.state.events.contact.protagonistEntry.status).toBe('pending');
  expect(data.state.events.contact.blockers).toEqual(['部分意见尚未一致']);expect(data.state.npc).toEqual(baseline.npc);expect(data.draft.userInput).toBe('');expect(server.calls).toEqual(['story','variables','world']);
  await page.reload();await openGameTools(page);expect(server.calls).toHaveLength(3);expect((await stored(page)).state).toEqual(data.state);
  await page.getByLabel('你的行动',{exact:true}).fill('接听电话');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(2);await settled(page);
  data=await stored(page);expect(data.state.events.contact.protagonistEntry.status).toBe('presented');expect(data.state.journal[1].story.narrative).toContain(cue);
  await page.getByLabel('你的行动',{exact:true}).fill('我拒绝继续参加约谈。');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(3);await settled(page);
  data=await stored(page);expect(data.state.events.contact).toMatchObject({status:'blocked',protagonistEntry:{status:'declined'}});
  expect(data.state.events.contact.status).not.toBe('cancelled');expect(data.draft.userInput).toBe('');expect(server.calls).toHaveLength(9);
  await page.screenshot({path:info.outputPath('event-entry-refusal.png')});await page.reload();await openGameTools(page);
  expect(server.calls).toHaveLength(9);expect((await stored(page)).state).toEqual(data.state);
});

test('World失败与刷新不消费入场，恢复只请求World并原子确认正文回执',async({page})=>{
  await seed(page);const server=await mock(page);
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await settled(page);
  const before=(await stored(page)).state;server.control.failWorld=true;
  await page.getByLabel('你的行动',{exact:true}).fill('接听电话');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();let data=await stored(page);
  expect(data.state).toEqual(before);expect(data.draft.story.narrative).toContain(cue);expect(data.draft.variables.validation).toBe('validated');expect(data.draft.world).toBeUndefined();
  expect(server.calls).toHaveLength(6);await page.reload();await openGameTools(page);expect(server.calls).toHaveLength(6);
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(2);await settled(page);data=await stored(page);
  expect(data.state.events.contact.protagonistEntry.status).toBe('presented');expect(server.calls).toEqual(['story','variables','world','story','variables','world','world']);
});

test('两轮自动结算：选择性入场、留守离场、并行任务与独立模糊历史保存后刷新可读',async({page})=>{
  await seed(page);
  const baseline=(await stored(page)).state,calls:string[]=[];
  await page.route('https://entry-feedback.mock.invalid/**',async route=>{
    const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
    const turn=calls.filter(s=>s==='story').length;
    const messages=body.messages.map((m:{content:string})=>m.content).join('\n');
    const match=messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
    if(!match)throw Error('missing runtime context');
    const ctx=JSON.parse(match[1]);let text:string;
    if(stage==='story'){
      const entry=ctx.EVENT_ENTRIES?.find((e:{eventId:string})=>e.eventId==='call-one');
      if(turn===2)expect(ctx.EVENT_ENTRIES).toHaveLength(2);
      const guide=turn===1?[]:[{group:'event',observedFact:'只接听第一通来电',textEvidence:'林舟接听一通电话，随后出门。',eventInteraction:{eventId:entry.eventId,entryId:entry.entryId,action:'presented'}}];
      text=`<thinking>按本次行动叙事，其他来电等待。</thinking><正文>【旁白】${turn===1?'林舟在办公室整理材料。':'林舟接听一通电话，随后出门。'}</正文><短期记忆>整理材料并继续行动。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
    }else if(stage==='variables'){
      text=`<thinking>只更新已经发生的现场变化。</thinking><说明>其他人物留在原地。</说明><命令>set worldClock = "2026-10-18T08:${turn===1?'10':'20'}:00+08:00"${turn===1?'':'\nset locations[office-gate] = {"name":"办公楼门口"}\nset protagonist.locationId = "office-gate"'}</命令>`;
    }else{
      const result={worldCommands:[] as unknown[],taskCommands:[] as unknown[],eventCommands:[] as unknown[],visibleHooks:[],unresolved:[]};
      if(turn===1)result.eventCommands=['one','two'].map(id=>({type:'SaveEvent',commandId:`queue-${id}`,evidence:'日常联系',event:{
        id:`call-${id}`,title:`来电${id}`,backgroundText:'同事整理材料后联系',goalText:'交换工作信息',status:'active',
        startAt:'2026-10-18T08:00:00+08:00',estimatedEndAt:'2026-10-18T08:05:00+08:00',
        actorRefs:[{kind:'npc',id:'npc-a'}],linkedTaskIds:[],prerequisites:[],blockers:[],visibility:'hidden',impact:'minor',sourceTurnIds:[ctx.TURN_CONTEXT.turnId],
        continuation:{direction:'protagonist',reason:'电话联系',entry:{channel:'电话',cue:`第${id}通来电`}},
      }}));
      else{
        result.worldCommands=[{type:'RecordHistory',commandId:'remember',evidence:'本幕人物披露',entry:{id:'university-disclosure',title:'大学时期的合作',summary:'同事声称大学时期与朋友合作过。',occurredTimeText:'大学时期',knowledgeKind:'reported',sourceRef:{kind:'npc',id:'npc-a'}}}];
        result.taskCommands=['active','planned'].map((status,i)=>({type:'SaveTask',commandId:`parallel-${i}`,evidence:'不同职责并行',task:{id:`duty-${i}`,actorRef:{kind:'npc',id:'npc-a'},goal:`独立职责${i}`,startAt:'2026-10-18T08:00:00+08:00',dueAt:'2026-10-19T08:00:00+08:00',status,prerequisites:[],blockers:[]}}));
      }
      text=JSON.stringify(result);
    }
    await route.fulfill({contentType:stage==='story'?'text/event-stream':'application/json',body:stage==='story'
      ?`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`
      :JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await settled(page);
  await page.getByLabel('你的行动',{exact:true}).fill('先接一通电话，然后独自出门。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(2);await settled(page);
  const data=await stored(page);
  expect(data.state.events['call-one'].protagonistEntry.status).toBe('presented');
  expect(data.state.events['call-two'].protagonistEntry.status).toBe('pending');
  expect(data.state.npc.scene).toEqual({...baseline.npc.scene,onScene:false});
  expect(data.state.npc['npc-a'].memories).toEqual(baseline.npc['npc-a'].memories);
  expect(Object.keys(data.state.tasks)).toHaveLength(2);
  expect(data.state.timeline[0]).toMatchObject({knowledgeKind:'reported',occurredTimeText:'大学时期',recordedAt:data.state.worldClock});
  expect(data.state.timeline[0].eventId).toBeUndefined();expect(data.state.timeline[0].occurredAt).toBeUndefined();
  expect(calls).toEqual(['story','variables','world','story','variables','world']);
  await page.reload();await openGameTools(page);
  expect((await stored(page)).state).toEqual(data.state);expect(calls).toHaveLength(6);
  await openWorldArchive(page);
  await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:/历史时间轴/}).click();
  const dialog=page.getByRole('dialog',{name:'历史时间轴',exact:true});await expect(dialog.getByText('大学时期的合作',{exact:true})).toBeVisible();
  await expect(dialog.getByText('人物陈述',{exact:true})).toBeVisible();await expect(dialog.getByText('大学时期',{exact:true})).toBeVisible();
  expect(calls).toHaveLength(6);
});
