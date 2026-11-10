import { expectWorldWithNpcProjection } from './fixtures/contextAssertions';
import { expect, it } from 'vitest';
import { StorySchema } from '../domain/state';
import { parseVariables } from '../services/validation/aiOutputs';
import { timePreflight } from '../domain/timePreflight';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { stageContext } from './fixtures/eventStages';

it('无旧邀请时真实Story结构可声明入场，保持原有标签与规划字段',()=>{
  const a=stageContext();
  expect(StorySchema.safeParse({...a.draft.story,variableGuide:[{group:'event',observedFact:'主角实际进入资料室',eventNarration:{eventId:'stage-one',mode:'enter',at:'2027-01-02T00:00:00+08:00'}}]}).success).toBe(true);
});
it('time:pause的实际停止点不能被变量推进越过',()=>{
  const a=stageContext();a.draft.turnKind='regular';a.draft.story!.turnKind='regular';a.draft.userInput='跳过三个月';
  a.draft.story!.variableGuide=[{group:'time',subjectHint:'time:pause',observedFact:'2027-01-02T00:00:00+08:00',textEvidence:'实际停止'}];
  expect(()=>parseVariables(JSON.stringify(a.draft.variables!.result),a.state,a.draft)).toThrow();
});
it.each(['跳过三个月','一年后再回来','直接过半年'])('长期行动%s使用自然月候选而非固定天数',action=>{
  const a=stageContext();expect(timePreflight(a.state,action)).toMatchObject({resolution:'estimated'});
});
it('实际普通Story请求含新增裁定Step，原有末步顺延',async()=>{
  const a=stageContext();a.draft.turnKind='regular';a.draft.story!.turnKind='regular';const p=await composePrompt({stage:'story',mode:'regular',state:a.state,draft:a.draft,userInput:'继续',settings:defaultSettings()});
  const text=p.messages.map(m=>m.content).join('\n');expect(text).toContain('Step 12｜世界事件与主角入场裁定');expect(text).toContain('Step 15｜让本轮故事真实地留在世界中');
});

import { afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { validateStoryEventInteractions } from '../domain/events/interactions';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { endStage, stageCommand } from './fixtures/eventStages';
import { SaveRepository } from '../services/storage/saveRepository';
import { submission, completeDraft } from './fixtures/turn';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
const stop='2027-02-10T12:00:00+08:00',target='2027-04-01T00:00:00+08:00';
function scenario(mode:'enter'|'mention'|'none'='enter') {
  const a=stageContext();a.state.revision=1;a.state.turnNumber=1;a.state.events['stage-one'].fixedEndAt='2027-03-01T00:00:00+08:00';
  a.state.events['stage-one'].visibility='hidden';
  a.state.journal=[{turnId:'synthetic-opening',revision:1,story:a.draft.story!,relatedActorRefs:[]}];
  const state=GameStateSchema.parse(a.state),base=createTurnDraft('save-a',1,'arbitration-turn','regular','跳过三个月');
  const narration={group:'event' as const,observedFact:'主角通过实际渠道接触资料核查',textEvidence:'本幕实际接触说明',eventNarration:{eventId:'stage-one',mode:mode==='enter'?'enter' as const:'mention' as const,at:stop}};
  const guides=[{group:'time' as const,subjectHint:mode==='enter'?'time:pause':'time:end',observedFact:mode==='enter'?stop:target,textEvidence:'本轮实际停止时间'},...(mode==='none'?[]:[narration])];
  const draft=rerollStory(base,{turnKind:'regular',narrative:'【旁白】你收到了资料室的电话。\n【同事】“请核对资料。”',summary:'本轮实际接触资料。',variableGuide:guides});
  const scene={status:'resolved',resolvedAt:stop,outcome:'changed',resolutionText:'主角实际介入，使本轮核查提前结束。'};
  const variables='<thinking>落实所选正文。</thinking><说明>只写本幕变化。</说明><命令>'+ (mode==='enter'?`set events[stage-one].sceneState = ${JSON.stringify(scene)}`:`set worldClock = ${JSON.stringify(target)}`)+'</命令>';
  return {state,base,draft,variables,scene};
}
const withVariables=(draft:ReturnType<typeof scenario>['draft'],result:Awaited<ReturnType<typeof parseTextVariables>>)=>TurnDraftSchema.parse({...draft,variables:{storyRevision:draft.storyRevision,candidateRevision:1,requestRevision:draft.stageRequestRevisions.variables,validation:'validated',result},stageStatus:{...draft.stageStatus,variables:'ready'}});
it('主动入场仅授权指定事件sceneState；无旧entry也可提前结束且时钟采用实际pause',async()=>{
  const a=scenario(),before=structuredClone(a.state),result=await parseTextVariables(a.variables,a.state,a.draft),draft=withVariables(a.draft,result);
  const next=projectTurn(a.state,draft);expect(next.worldClock).toBe(stop);expect(next.events['stage-one']).toMatchObject(a.scene);
  expect(next.events['stage-one'].fixedEndAt).toBe(a.state.events['stage-one'].fixedEndAt);expect(next.events['stage-one'].protagonistEntry).toBeUndefined();
  expect(next.events['stage-one'].protagonistKnowledge).toBeUndefined();expect(next.npc).toEqual(a.state.npc);expect(a.state).toEqual(before);
  const p=await composePrompt({stage:'world',mode:'regular',state:a.state,draft,userInput:draft.userInput,settings:defaultSettings()});
  expect(p.context.STORY_RESULT).toMatchObject({eventNarrations:[expect.objectContaining({eventNarration:{eventId:'stage-one',mode:'enter',at:stop}})]});
  expect(JSON.stringify(p.context)).toContain('实际介入，使本轮核查提前结束');
  const repeated={worldCommands:[],taskCommands:[],eventCommands:[stageCommand({...next.events['stage-one'],resolvedAt:a.state.events['stage-one'].fixedEndAt})],visibleHooks:[],unresolved:[]};
  expect(()=>parseWorld(JSON.stringify(repeated),a.state,draft)).toThrow();
});
it('mention或无裁定不能取得场外sceneState权限，也不自动消耗邀请或传播知识',async()=>{
  for(const mode of ['mention','none'] as const){
    const a=scenario(mode);await expect(parseTextVariables(a.variables.replace(/set worldClock[^<]+/,`set events[stage-one].sceneState = ${JSON.stringify(a.scene)}`),a.state,a.draft)).rejects.toThrow();
    const projected=projectTurn(a.state,withVariables(a.draft,await parseTextVariables(a.variables,a.state,a.draft)));
    expect(projected.events['stage-one']).toEqual(a.state.events['stage-one']);expect(projected.npc).toEqual(a.state.npc);
  }
});
it('新叙事裁定不能修改事件固定时间或规划，也不能伪造protagonistEntry',async()=>{
  const a=scenario(),result=await parseTextVariables(a.variables,a.state,a.draft),command=result.commands.find(c=>c.type==='SaveEvent')!;
  for(const changes of [{fixedEndAt:stop},{backgroundText:'被改写的后台规划'},{protagonistEntry:{id:'forged',sourceTurnId:a.draft.turnId,queuedAt:stop,channel:'电话',cue:'伪造',status:'presented',handledTurnId:a.draft.turnId}}]){
    expect(()=>parseVariables(JSON.stringify({...result,commands:result.commands.map(c=>c===command?{...command,event:{...command.event,...changes}}:c)}),a.state,a.draft)).toThrow();
  }
});
it.each(['reference','duplicate','past','future_start','mixed'] as const)('Story结构化裁定%s被拒绝，不以正文关键词授权',kind=>{
  const a=scenario(),guide=a.draft.story!.variableGuide[1];
  if(kind==='reference')guide.eventNarration!.eventId='missing-event';
  if(kind==='duplicate')a.draft.story!.variableGuide.push(structuredClone(guide));
  if(kind==='past')guide.eventNarration!.at='2026-12-31T00:00:00+08:00';
  if(kind==='future_start')a.state.events['stage-one'].startAt='2027-02-11T00:00:00+08:00';
  if(kind==='mixed')guide.eventInteraction={eventId:'stage-one',entryId:'forged',action:'presented'};
  expect(()=>validateStoryEventInteractions(a.state,a.draft.story!)).toThrow();
});
it('实际接触晚于变量时钟会拒绝；修正所选Story后原候选权限不复活',async()=>{
  const a=scenario('mention');a.draft.story!.variableGuide=[];
  const result=await parseTextVariables(a.variables,a.state,a.draft);
  a.draft.story!.variableGuide=[{group:'event',observedFact:'未来接触',eventNarration:{eventId:'stage-one',mode:'mention',at:'2027-05-01T00:00:00+08:00'}}];
  expect(()=>projectTurn(a.state,withVariables(a.draft,result))).toThrow();
  const entered=scenario(),v=await parseTextVariables(entered.variables,entered.state,entered.draft),rolled=rerollStory(withVariables(entered.draft,v),{...entered.draft.story!,variableGuide:[]});
  expect(rolled.variables).toBeUndefined();expect(()=>parseVariables(JSON.stringify(v),entered.state,rolled)).toThrow();
});
it.each([
  ['2027-01-31T12:00:00+08:00','跳过一个月','2027-02-28'],
  ['2028-01-31T12:00:00+08:00','跳过一个月','2028-02-29'],
  ['2028-02-29T12:00:00+08:00','一年后再回来','2029-02-28'],
  ['2027-10-10T12:00:00+08:00','直接过半年','2028-04-10'],
])('日历跨度%s %s保留模糊日窗口', (clock,action,date)=>{
  const a=scenario();a.state.worldClock=clock;const plan=timePreflight(a.state,action);
  expect(plan.targetAt).toBeUndefined();expect(plan.endWindow?.from).toBe(date+'T00:00:00+08:00');expect(plan.endWindow?.to).toBe(date+'T23:59:59.999+08:00');
});
it('完整Story请求提供隐藏正式事件身份但不将索引升级为角色知识，近期与完整世界不裁剪',async()=>{
  const a=scenario(),before=structuredClone(a.state),p=await composePrompt({stage:'story',mode:'regular',state:a.state,draft:a.base,userInput:a.base.userInput,settings:defaultSettings()});
  expect(p.context.EVENT_NARRATION_INDEX).toEqual(expect.arrayContaining([expect.objectContaining({eventId:'stage-one',eventKind:'sub',fixedEndAt:a.state.events['stage-one'].fixedEndAt,visibility:'hidden'})]));
  expect(p.context.KNOWN_EVENTS).not.toEqual(expect.arrayContaining([expect.objectContaining({id:'stage-one'})]));
  expectWorldWithNpcProjection(p.context,a.state);expect(a.state).toEqual(before);
});
const repos:SaveRepository[]=[];afterEach(()=>repos.splice(0).forEach(r=>r.close()));
it.each(['enter','mention','none','enter-retry'] as const)('真实Coordinator→Story Runtime→文本Variables→World→Commit→重载/撤回：%s',async selectedMode=>{
  const mode=selectedMode==='enter-retry'?'enter':selectedMode;
  const a=scenario(mode),repo=await SaveRepository.open('story-arbitration-'+mode,new IDBFactory());repos.push(repo);await repo.create({...a.state,revision:0,turnNumber:0,journal:[]});
  const opening=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:{worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]}});
  const first=await repo.commitTurn(submission(opening,''));a.state=first.state;await repo.deleteDraft('save-a',first.draft.draftRevision);await repo.saveDraft(a.base,null);
  const cfg=defaultAiConfig(),ch=newChannel();ch.baseUrl='https://story-arbitration.mock.invalid/v1';ch.defaultModel='story';cfg.channels=[ch];cfg.routes.story={channelId:ch.id,modelId:'story'};cfg.routes.variables={mode:'independent',channelId:ch.id,modelId:'variables'};cfg.routes.world={mode:'independent',channelId:ch.id,modelId:'world'};
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}},vault=new CredentialVault(storage,storage);vault.set(ch.id,'test-arbitration-secret-only');
  const settings=defaultSettings();settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;
  let worldCalls=0;const calls:string[]=[],fetcher=vi.fn<typeof fetch>(async(_url,options)=>{
    const body=JSON.parse(String(options?.body)),stage=body.model;calls.push(stage);
    const messages=body.messages.map((m:{content:string})=>m.content).join('\n');
    if(stage==='story')expect(messages).toContain('Step 12｜世界事件与主角入场裁定');
    if(stage==='world')expect(messages).toContain(mode==='enter'?'主角实际介入，使本轮核查提前结束。':'fixedEndAt');
    const event={...endStage(a.state.events['stage-one']),sourceTurnIds:[a.base.turnId]};
    if(stage==='world' && ++worldCalls===1 && selectedMode==='enter-retry')return Response.json({choices:[{message:{content:'{invalid'},finish_reason:'stop'}]});
    const text=stage==='story'?`<thinking>结合实际世界安排事件接触。</thinking><正文>${a.draft.story!.narrative}</正文><短期记忆>本轮生活发生变化。</短期记忆><变量规划>${JSON.stringify(a.draft.story!.variableGuide)}</变量规划>`:stage==='variables'?a.variables:JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:mode==='enter'?[]:[stageCommand(event)],visibleHooks:[],unresolved:[]});
    return stage==='story'?new Response(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}}):Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});
  });
  const coordinator=new TurnCoordinator(repo,new AiClient(fetcher));try{
    if(selectedMode==='enter-retry') {
      await expect(coordinator.generate({draft:a.base,settings,config:cfg,vault})).rejects.toThrow();
      expect(await repo.load('save-a')).toEqual(a.state);const failed=await repo.loadDraft('save-a');expect(failed?.story?.variableGuide).toEqual(a.draft.story!.variableGuide);expect(failed?.variables?.validation).toBe('validated');a.base=failed!;
    }
    const out=await coordinator.generate({draft:a.base,settings,config:cfg,vault});expect(out.status).toBe('complete');
    const committed=await repo.commitTurn(submission(out.draft,''));expect(calls).toEqual(selectedMode==='enter-retry'?['story','variables','world','world']:['story','variables','world']);
    expect(committed.state.worldClock).toBe(mode==='enter'?stop:target);expect(committed.state.events['stage-one'].resolvedAt).toBe(mode==='enter'?stop:a.state.events['stage-one'].fixedEndAt);
    expect(committed.state.events['stage-one'].protagonistEntry).toBeUndefined();expect(committed.state.events['stage-one'].protagonistKnowledge).toBeUndefined();expect(committed.state.npc).toEqual(a.state.npc);
    expect((await repo.commitTurn(submission(out.draft,''))).replayed).toBe(true);expect((await repo.loadGame('save-a')).state).toEqual(committed.state);
    const undone=await repo.undoTurn({saveId:'save-a',expectedRevision:committed.state.revision,expectedDraft:committed.draft,operationId:'undo-arbitration'});
    expect(undone.state.events).toEqual(a.state.events);expect(undone.state.worldClock).toBe(a.state.worldClock);expect(undone.input).toBe(a.base.userInput);expect(calls).toHaveLength(selectedMode==='enter-retry'?4:3);
  }finally{coordinator.dispose();}
});
it('主动裁定不冒充既有pending身份，mention保留旧安排；合法旧eventInteraction继续处理',()=>{
  const a=scenario(),e=a.state.events['stage-one'];e.sourceTurnIds=['synthetic-opening'];
  e.protagonistEntry={id:'real-entry',sourceTurnId:'synthetic-opening',queuedAt:a.state.worldClock,channel:'电话',cue:'真实邀请',status:'pending'};
  expect(()=>validateStoryEventInteractions(a.state,a.draft.story!)).toThrow();
  a.draft.story!.variableGuide[1].eventNarration!.mode='mention';expect(()=>validateStoryEventInteractions(a.state,a.draft.story!)).not.toThrow();
  const old=structuredClone(a.draft.story!);old.variableGuide=[{group:'event',observedFact:'本轮呈现',textEvidence:'已呈现电话',eventInteraction:{eventId:e.id,entryId:'real-entry',action:'presented'}}];
  expect(()=>validateStoryEventInteractions(a.state,old)).not.toThrow();
  old.variableGuide[0].eventInteraction!.entryId='stale';expect(()=>validateStoryEventInteractions(a.state,old)).toThrow();
});
it('普通回合规划0–15完整顺延，开局规划仍独立，旧Story可读',async()=>{
  const a=scenario();const regular=await composePrompt({stage:'story',mode:'regular',state:a.state,draft:a.base,userInput:'继续',settings:defaultSettings()});
  const text=regular.messages.map(m=>m.content).join('\n');expect([...text.matchAll(/### Step (\d+)｜/g)].map(m=>Number(m[1]))).toEqual(Array.from({length:16},(_,i)=>i));
  expect(StorySchema.parse({turnKind:'regular',narrative:'没有新字段的旧正文',summary:'旧摘要',variableGuide:[]})).toMatchObject({variableGuide:[]});
});

it.each([
  ['2027-03-01T00:00:00.001+08:00',false],
  ['2027-02-28T16:00:00.001Z',false],
  ['2027-03-01T00:00:00+08:00',true],
  ['2027-02-28T16:00:00Z',true],
  ['2027-02-28T11:00:00-05:00',true],
  ['2027-02-28T23:59:59.999+08:00',true],
] as const)('sub实际enter时间%s与原fixedEndAt按时间戳比较，允许=%s',(at,allowed)=>{
  const a=scenario(),before=structuredClone(a.state);a.draft.story!.variableGuide[1].eventNarration!.at=at;
  const story=StorySchema.parse(a.draft.story);
  if(allowed)expect(()=>validateStoryEventInteractions(a.state,story)).not.toThrow();
  else expect(()=>validateStoryEventInteractions(a.state,story)).toThrow(expect.objectContaining({code:'EVENT_ENTRY',diagnostic:expect.objectContaining({storyRule:'narration_time'})}));
  expect(a.state).toEqual(before);expect(story.variableGuide[1].eventNarration!.at).toBe(at);
});
it.each(['sub-mention','main-enter','legacy-enter'] as const)('%s不套用小事件固定入场上界',kind=>{
  const a=scenario(),guide=a.draft.story!.variableGuide[1];guide.eventNarration!.at=target;
  if(kind==='sub-mention')guide.eventNarration!.mode='mention';
  if(kind==='main-enter')guide.eventNarration!.eventId='main-stage';
  if(kind==='legacy-enter'){
    const {eventKind:_kind,parentEventId:_parent,fixedEndAt:_fixed,...legacy}=a.state.events['stage-one'];void _kind;void _parent;void _fixed;
    a.state.events['stage-one']={...legacy,estimatedEndAt:'2027-03-01T00:00:00+08:00'};
  }
  const state=GameStateSchema.parse(a.state);expect(()=>validateStoryEventInteractions(state,StorySchema.parse(a.draft.story))).not.toThrow();
});
it('结束后入场不能从文本模拟或伪造validated候选获得权限，截止时刻仍可正常落账',async()=>{
  const a=scenario(),before=structuredClone(a.state),deadline=a.state.events['stage-one'].fixedEndAt!;
  const late='2027-03-01T00:00:00.001+08:00';
  a.draft.story!.variableGuide[0].observedFact=late;a.draft.story!.variableGuide[1].eventNarration!.at=late;
  const lateText=a.variables.replaceAll(stop,late);
  await expect(parseTextVariables(lateText,a.state,a.draft)).rejects.toThrow();
  expect(()=>projectTurn(a.state,withVariables(a.draft,{commands:[],rejectedSuggestions:[],unresolved:[]}))).toThrow();
  expect(a.state).toEqual(before);
  a.draft.story!.variableGuide[0].observedFact=deadline;a.draft.story!.variableGuide[1].eventNarration!.at='2027-02-28T16:00:00Z';
  const result=await parseTextVariables(a.variables.replaceAll(stop,deadline),a.state,a.draft),selected=withVariables(a.draft,result);
  expect(projectTurn(a.state,selected).events['stage-one']).toMatchObject({resolvedAt:deadline,fixedEndAt:deadline});
  expect(parseWorld(JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]}),a.state,selected)).toMatchObject({eventCommands:[]});
});
