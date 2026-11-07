import { variableTextEnvelope } from './fixtures/variableReply';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { record, array, string } from '../services/ai/protocols';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { createTurnDraft, rerollStory, startStageAttempt } from '../domain/drafts';
import { completeTurnDraft } from '../domain/turnCommit';
import { projectTurn, variableCommandsForTurn } from '../domain/turnProjection';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldResult, proof } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';
import { event, task } from './fixtures/game';

const repos: SaveRepository[] = [], runners: TurnCoordinator[] = [];
afterEach(() => { runners.splice(0).forEach(r => r.dispose()); repos.splice(0).forEach(r => r.close()); vi.restoreAllMocks(); });
const initialAt = '2015-07-08T08:00:00+08:00', openingEnd = '2015-07-08T08:05:00+08:00';
function settingsAndRoute() {
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'story'; channel.compatibility.jsonMode = true;
  config.channels = [channel]; config.routes.story = {channelId:channel.id,modelId:'story'};
  config.routes.variables = {mode:'independent',channelId:channel.id,modelId:'variables'};
  config.routes.world = {mode:'independent',channelId:channel.id,modelId:'world'};
  const data = new Map<string,string>(), storage = {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
  const vault = new CredentialVault(storage,storage); vault.set(channel.id,'test-live-secret');
  const settings = defaultSettings(); settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 1;
  return {config,vault,settings};
}
async function fixture(mode:'opening'|'regular' = 'opening') {
  const repo = await SaveRepository.open('live-text',new IDBFactory()); repos.push(repo);
  const state = worldState();
  if (mode === 'opening') { state.openingTimePending = true; state.worldClock = '0001-01-01T00:00:00+08:00'; }
  // Scene transfers in this fixture are explicitly controlled by text commands.
  state.npc.scene.onScene = false;
  await repo.create(state);
  let draft = createTurnDraft(state.saveId,0,'live-opening','opening','');
  await repo.saveDraft(draft,null);
  if (mode === 'regular') {
    const old = await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
    draft = (await repo.commitTurn(submission(old,'在社区交流'))).draft;
  }
  return {repo,draft,...settingsAndRoute()};
}
function envelope(text:string,stream=false) {
  return stream ? new Response(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})
    : Response.json({choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70}});
}
const block=(body='')=>`<thinking>仅为输入数据，不执行。</thinking><说明>这里不代表任何已落库状态。</说明><命令>\n${body}\n</命令>`;
const set=(path:string,value:unknown)=>`set ${path} = ${JSON.stringify(value)}`;
function transport(reply:(context:Record<string,unknown>)=>string, world:(context:Record<string,unknown>)=>unknown = ()=>worldResult(), story?: (context:Record<string,unknown>)=>{narrative:string;guide:unknown[]}) {
  const calls: {stage:string;context:Record<string,unknown>;body:Record<string,unknown>}[]=[];
  const fetcher = vi.fn<typeof fetch>(async(_url,init)=>{
    const body=record(JSON.parse(String(init?.body))), stage=string(body.model);
    const messages=array(body.messages).map(m=>string(record(m).content)).join('\n');
    const match=messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
    if(!match)throw new Error('missing real composed context');
    const context=record(JSON.parse(match[1]));calls.push({stage,context,body});
    if(stage==='story') {
      const pending=record(context.OPENING_TIME).status==='pending';
      const guides=pending?[{group:'time',subjectHint:'time:opening',observedFact:JSON.stringify({startAt:initialAt,endAt:openingEnd})}]:[];
      const custom=story?.(context);
      return envelope(`<thinking>创作提纲：保持当前事实连续。</thinking><正文>${custom?.narrative??"主角在社区与同事会面，收到报酬，购买手机并交给同事。"}</正文><短期记忆>在社区完成会面和交付。</短期记忆><变量规划>${JSON.stringify(custom?.guide??guides)}</变量规划>`,true);
    }
    return envelope(stage==='variables'?reply(context):JSON.stringify(world(context)));
  });
  return {fetcher,calls};
}
function coordinator(repo:SaveRepository,fetcher:typeof fetch) {const runner=new TurnCoordinator(repo,new AiClient(fetcher));runners.push(runner);return runner;}

describe('正式协调器 → 文本编译 → World JSON → 原子Commit → 重载',()=>{
  it.each(['opening','regular'] as const)('%s 多组文本能力保留并正确投影，正式状态只在提交后改变',async(mode)=>{
    const a=await fixture(mode), before=await a.repo.load('save-a');
    const end=mode==='opening'?openingEnd:'2026-10-18T08:10:00+08:00';
    const t=transport(()=>block([
      ...(mode==='regular'?[set('worldClock',end)]:[]),
      set('locations[clinic]',{name:'社区诊所',parentId:'chongqing'}),set('protagonist.locationId','clinic'),
      set('npc[new-person]',{identityKey:'community-worker',kind:'ordinary',name:'周宁',aliases:[],skills:[],locationId:'clinic',onScene:true,affinity:0,relationshipText:'初次会面',memories:[],knownInformation:[]}),
      set('npc[new-person].affinityChange',{from:0,to:5,reason:'完成协作',relationshipText:'愿意协作'}),
      'push npc[new-person].memories = {"text":"今天在社区收到手机","knowledgeKind":"observed","knowledgeSource":"亲自接收","visibility":"npc_private"}',
      set('economy.incomes[pay]',{source:'本次报酬',amount:4500,status:'received',account:'cash',receivedAt:end,sourceTurnId:a.draft.turnId}),
      'add economy.cash = -3000',
      set('items[phone].purchase',{account:'cash',price:2500,item:{name:'手机',category:'device',quantity:1,ownerRef:{kind:'protagonist',id:'hero'},conditionText:'完好'}}),
      set('items[phone].transfer',{from:{kind:'protagonist',id:'hero'},to:{kind:'npc',id:'new-person'}}),
      set('organizations[shop]',{kind:'business',name:'社区商行',description:'社区商行',protagonistRelation:'首次消费',relationHistory:[],keyNpcIds:['new-person'],currentTaskIds:[],sectors:[],businessRelations:[]}),
    ].join('\n')));
    const completed=await coordinator(a.repo,t.fetcher).generate(a);
    expect(completed.status).toBe('complete');expect(completeTurnDraft(completed.draft)).toBeTruthy();
    expect(t.calls.map(c=>c.stage)).toEqual(['story','variables','world']);
    const vars=completed.draft.variables!.result.commands;
    expect(vars.filter(c=>c.type==='SetWorldClock')).toHaveLength(1);
    if(mode==='opening')expect(vars[0].commandId).toBe('opening-clock:1');
    expect(new Set(vars.map(c=>c.commandId)).size).toBe(vars.length);
    const wc=t.calls[2].context;
    expect(wc.worldClock).toBe(end);expect(wc.BASE_SAVE_REVISION).toBe(before.revision);
    expect(record(wc.PROTECTED_SCENE).sceneNpcIds).toContain('new-person');
    expect(JSON.stringify(wc.VARIABLE_RESULT)).toContain('RecordNpcMemory');
    expect(record(record(wc.OFFSCREEN_STATE).organizations).shop).toMatchObject({name:'社区商行'});
    expect(t.calls[1].body).not.toHaveProperty('response_format');expect(t.calls[2].body).toHaveProperty('response_format',{type:'json_object'});
    expect(await a.repo.load('save-a')).toEqual(before);
    const projection=projectTurn(before,completed.draft);
    expect(projection.economy.cash).toBe(9000);expect(projection.protagonist.locationId).toBe('clinic');
    expect(projection.npc['new-person']).toMatchObject({affinity:5,memories:[expect.objectContaining({text:'今天在社区收到手机',createdAtGameTime:end})]});
    const result=await a.repo.commitTurn(submission(completed.draft,'离开诊所'));
    expect(result.state.worldClock).toBe(end);expect(result.state.economy.incomes.pay.amount).toBe(4500);
    expect(result.state.items.phone.ownerRef).toEqual({kind:'npc',id:'new-person'});
    expect((await a.repo.commitTurn(submission(completed.draft,'离开诊所'))).replayed).toBe(true);
    expect(await a.repo.load('save-a')).toEqual(result.state);
    expect(result.draft.turnKind).toBe('regular');expect(result.draft.userInput).toBe('离开诊所');
    const next=transport(()=>block());const runner=coordinator(a.repo,next.fetcher);
    const resumed=await runner.generate({...a,draft:result.draft});
    expect(resumed.status).toBe('complete');expect(next.calls.map(c=>c.stage)).toEqual(['story','variables','world']);
    expect((await a.repo.load('save-a')).revision).toBe(result.state.revision);
  });
  it('原World任务、隐藏事件仍使用JSON来源协议，提交后才落库',async()=>{
    const a=await fixture('regular'),before=await a.repo.load('save-a');
    const at='2026-10-18T08:05:00+08:00',future='2026-10-18T09:00:00+08:00';
    const t=transport(()=>block(set('worldClock','2026-10-18T08:10:00+08:00')),(ctx)=>{
      const evidence=proof({kind:'planned',at,fact:'同事计划整理诊室。'});
      return {...worldResult(),taskCommands:[{type:'SaveTask',commandId:'world-job',evidence,task:{...task(),actorRef:{kind:'npc',id:'npc-a'},goal:'整理诊室',startAt:future,dueAt:future}}],
        eventCommands:[{type:'SaveEvent',commandId:'world-event',evidence,event:{...event(),actorRefs:[{kind:'npc',id:'npc-a'}],startAt:future,estimatedEndAt:future,sourceTurnIds:[string(record(ctx.TURN_CONTEXT).turnId)]}}]};
    });
    const completed=await coordinator(a.repo,t.fetcher).generate(a);expect(await a.repo.load('save-a')).toEqual(before);
    const saved=await a.repo.commitTurn(submission(completed.draft));
    expect(saved.state.tasks['task-a'].status).toBe('planned');expect(saved.state.events['event-a'].visibility).toBe('hidden');
    expect(JSON.stringify(saved.state.journal)).not.toContain('内部候选线索');
  });
  it('正文现场任务可创建，已有事件用sceneState更新后按原Commit规则结算',async()=>{
    const a=await fixture('regular'),at='2026-10-18T08:10:00+08:00';
    await a.repo.save('save-a',1,'seed-scene',[{type:'SaveEvent',commandId:'scene-event',event:{...event('scene-event'),sourceTurnIds:[(await a.repo.load('save-a')).journal[0].turnId]},evidence:'已有现场安排'}]);
    await a.repo.deleteDraft('save-a',a.draft.draftRevision);
    a.draft=createTurnDraft('save-a',2,'scene-update','regular','继续');await a.repo.saveDraft(a.draft,null);
    const {id:_task,...sceneTask}=task('scene-task');void _task;
    const t=transport(()=>block([set('worldClock',at),
      set('tasks[scene-task]',{...sceneTask,status:'active'}),
      set('events[scene-event].sceneState',{status:'active'}),
    ].join('\n')));
    const done=await coordinator(a.repo,t.fetcher).generate(a);
    const saved=await a.repo.commitTurn(submission(done.draft));
    expect(saved.state.tasks['scene-task'].status).toBe('active');expect(saved.state.events['scene-event'].status).toBe('active');
  });
  it('Variables不能通过新增路径把场外任务结算写入正式存档',async()=>{
    const a=await fixture('regular'),before=await a.repo.load('save-a');
    const {id:_id,...value}=task('background');void _id;
    const t=transport(()=>block(set('tasks[background]',{...value,actorRef:{kind:'npc',id:'npc-a'},status:'active'})));
    await expect(coordinator(a.repo,t.fetcher).generate(a)).rejects.toMatchObject({code:'data_integrity'});
    expect(t.calls.map(c=>c.stage)).toEqual(['story','variables']);
    expect(await a.repo.load('save-a')).toEqual(before);
  });
  it.each(['',set('worldClock',openingEnd),set('items[note]',{name:'便条',category:'document',quantity:1,conditionText:'完好',ownerRef:{kind:'protagonist',id:'hero'}})])('开局空块/等值时钟/物品在刷新后只应用一次时钟：%s',async(body)=>{
    const a=await fixture(),before=await a.repo.load('save-a'),t=transport(()=>block(body));
    const completed=await coordinator(a.repo,t.fetcher).generate(a);
    const reloaded=await a.repo.loadDraft('save-a');expect(reloaded).toEqual(completed.draft);
    if(!reloaded)throw new Error('missing persisted draft');
    expect(variableCommandsForTurn(before,reloaded,reloaded.variables!.result.commands).filter(c=>c.type==='SetWorldClock')).toHaveLength(1);
    expect((await coordinator(a.repo,t.fetcher).generate({...a,draft:reloaded})).status).toBe('complete');
    expect(t.calls).toHaveLength(3);
    const saved=await a.repo.commitTurn(submission(reloaded));await a.repo.commitTurn(submission(reloaded));
    expect(saved.state.appliedCommands.filter(c=>c.commandId.startsWith('opening-clock:'))).toHaveLength(1);
    expect((await a.repo.load('save-a')).worldClock).toBe(openingEnd);
  });
  it.each(['{"commands":[],"rejectedSuggestions":[],"unresolved":[]}',block('set missing.field = 1'),block('add economy.cash = -999999')])('非法新响应不回退、不请求World、不污染存档：%s',async(text)=>{
    const a=await fixture(),before=await a.repo.load('save-a'),t=transport(()=>text);
    await expect(coordinator(a.repo,t.fetcher).generate(a)).rejects.toThrow();
    expect(t.calls.map(c=>c.stage)).toEqual(['story','variables']);expect(await a.repo.load('save-a')).toEqual(before);
    const d=await a.repo.loadDraft('save-a');expect(d?.stageStatus.variables).toBe('failed');expect(d?.story).toBeDefined();expect(d?.variables).toBeUndefined();
  });
  it('旧JSON领域候选继续恢复World与Commit，不重新调用Variables',async()=>{
    const a=await fixture('regular');const old=await completeDraft(a.repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
    const pending = startStageAttempt(old, ['world'], { useVariableStage: true, useWorldStage: true });
    await a.repo.saveDraft(pending, old.draftRevision);
    const t=transport(()=>{throw new Error('should not call variables');});
    const out=await coordinator(a.repo,t.fetcher).generate({...a,draft:pending});
    expect(out.status).toBe('complete');expect(t.calls.map(c=>c.stage)).toEqual(['world']);
    expect(out.draft.variables).toEqual(old.variables);
    const result=await a.repo.commitTurn(submission(out.draft));expect(result.state.turnNumber).toBe(2);
  });
  it('数据库写入异常整体回滚，不重复扣款或保存半份记忆',async()=>{
    const a=await fixture(),t=transport(()=>block('add economy.cash = -3000'));
    const done=await coordinator(a.repo,t.fetcher).generate(a),before=await a.repo.loadGame('save-a');
    const put=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw new Error('mock database failure');return put.apply(this,args);});
    await expect(a.repo.commitTurn(submission(done.draft))).rejects.toThrow();spy.mockRestore();
    expect(await a.repo.loadGame('save-a')).toEqual(before);
    const committed=await a.repo.commitTurn(submission(done.draft));expect(committed.state.economy.cash).toBe(7000);expect(committed.state.memories.short.filter(m=>m.sourceTurnIds.includes(done.draft.turnId))).toHaveLength(1);
  });
  it('十个真实三阶段回合逐次提交、重载和精确重放，时钟连续且每回合仅三次Mock请求',async()=>{
    const a=await fixture();let draft=a.draft,lastClock=initialAt,total=0;
    for(let n=1;n<=10;n++){
      const nextClock=n===1?openingEnd:new Date(Date.parse(lastClock)+30000).toISOString();
      const t=transport(()=>block(n===1?'':set('worldClock',nextClock)));
      const out=await coordinator(a.repo,t.fetcher).generate({...a,draft});total+=t.calls.length;
      const saved=await a.repo.commitTurn(submission(out.draft,`第${n+1}幕`));await a.repo.commitTurn(submission(out.draft,`第${n+1}幕`));
      expect(Date.parse(saved.state.worldClock)).toBe(Date.parse(nextClock));expect(saved.state.turnNumber).toBe(n);expect(saved.state.journal).toHaveLength(n);
      expect((await a.repo.load('save-a')).worldClock).toBe(saved.state.worldClock);lastClock=saved.state.worldClock;draft=saved.draft;
    }
    expect(total).toBe(30);
  });
});

describe('非执行说明及安全诊断',()=>{
  it('说明含秘密或未执行事项时只保存固定提示，不提升为状态或公开内容',async()=>{
    const a=await fixture(),state=await a.repo.load('save-a');
    const draft=rerollStory(a.draft,{turnKind:'opening',narrative:'普通会面',summary:'会面',variableGuide:[{group:'time',subjectHint:'time:opening',observedFact:JSON.stringify({startAt:initialAt,endAt:openingEnd})}]});
    const result=await parseTextVariables(variableTextEnvelope('<说明>NPC内部秘密，消费一百万元；test-live-secret</说明><命令></命令>'),state,draft);
    expect(result.commands).toHaveLength(1);expect(result.unresolved).toEqual(['模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。']);
    expect(JSON.stringify(result)).not.toMatch(/一百万元|NPC内部秘密|test-live-secret/);
  });
  it('命令字符串里的说明标签只是值，不能触发非执行说明提示',async()=>{
    const a=await fixture('regular'),state=await a.repo.load('save-a');const draft=rerollStory(a.draft,{turnKind:'regular',narrative:'会面',summary:'会面',variableGuide:[]});
    const result=await parseTextVariables(variableTextEnvelope('<命令>set protagonist.emotionText = "想到<说明>中的句子"</命令>'),state,draft);
    expect(result.unresolved).toEqual([]);expect(result.commands).toHaveLength(1);
  });
});

describe('事件生命周期贯通真实Runtime、协调器和存档事务',()=>{
  async function dueFixture() {
    const a=await fixture('regular');
    const incident={...event('due-event'),title:'清点诊室',impact:'minor' as const,backgroundText:'值班间隙整理物资',goalText:'完成清点',
      actorRefs:[{kind:'npc' as const,id:'npc-a'}],status:'active' as const,estimatedEndAt:'2026-10-18T08:05:00+08:00',
      sourceTurnIds:[(await a.repo.load('save-a')).journal[0].turnId]};
    await a.repo.save('save-a',1,'seed-due',[{type:'SaveEvent',commandId:'seed-due-event',event:incident,evidence:'已有排程'}]);
    await a.repo.deleteDraft('save-a',a.draft.draftRevision);
    a.draft=createTurnDraft('save-a',2,'due-turn','regular','在家休息十分钟');await a.repo.saveDraft(a.draft,null);
    return {...a,incident};
  }
  function dueTransport(a:Awaited<ReturnType<typeof dueFixture>>,badVariables=false) {
    return transport(()=>block(badVariables?'add economy.cash = -999999':set('worldClock','2026-10-18T08:10:00+08:00')),(ctx)=>{
      expect(record(ctx.EVENT_SCHEDULE).due).toEqual([expect.objectContaining({eventId:'due-event'})]);
      const id=string(record(ctx.TURN_CONTEXT).turnId),result='同事完成清点并封存清单。';
      return {...worldResult(),eventCommands:[
        {type:'SaveEvent',commandId:'due-finish',event:{...a.incident,status:'resolved',resolvedAt:'2026-10-18T08:05:00+08:00',resolutionText:result,outcome:'success',sourceTurnIds:[...a.incident.sourceTurnIds,id]},
          evidence:proof({sources:['event:due-event','npc:npc-a'],fact:result,decision:{targetId:'due-event',status:'resolved',reason:'工作正常完成',result,conditionsSatisfied:true,continues:false,resultKnowledge:{facts:[result],reported:[],suspected:[]}}})},
        {type:'DeleteEvent',commandId:'due-clean',eventId:'due-event',expectedStatus:'resolved',reason:'普通事务结束无需继续追踪',evidence:proof({at:'2026-10-18T08:06:00+08:00',sources:['event:due-event'],fact:'事项完成后清理完整记录。',decision:{targetId:'due-event',status:'retired',reason:'清点已结束',result:'保留最小身份',conditionsSatisfied:true,continues:false}})},
      ]};
    });
  }
  it('一次World请求完成到期推演与清理；刷新、重复提交不重复执行，下一轮没有旧排程',async()=>{
    const a=await dueFixture(),before=await a.repo.load('save-a'),t=dueTransport(a);
    const done=await coordinator(a.repo,t.fetcher).generate(a);expect(t.calls.map(c=>c.stage)).toEqual(['story','variables','world']);
    expect(await a.repo.load('save-a')).toEqual(before);expect((await a.repo.loadDraft('save-a'))?.world).toEqual(done.draft.world);
    const resumed=await coordinator(a.repo,t.fetcher).generate({...a,draft:done.draft});expect(resumed.status).toBe('complete');expect(t.calls).toHaveLength(3);
    const input=submission(done.draft),saved=await a.repo.commitTurn(input),replay=await a.repo.commitTurn(input);
    expect(saved.state.events['due-event']).toBeUndefined();expect(saved.state.retiredEvents['due-event'].detail).toBeUndefined();
    expect(saved.state.timeline).toEqual([]);expect(replay.replayed).toBe(true);expect(await a.repo.load('save-a')).toEqual(saved.state);
    const next=transport(()=>block());await coordinator(a.repo,next.fetcher).generate({...a,draft:saved.draft});
    expect(record(next.calls[2].context.EVENT_SCHEDULE).due).toEqual([]);expect(JSON.stringify(next.calls[2].context.OFFSCREEN_STATE)).not.toContain('due-event');
  });
  it('删除与journal、记忆同事务回滚；重试只落库一次',async()=>{
    const a=await dueFixture(),t=dueTransport(a),done=await coordinator(a.repo,t.fetcher).generate(a),before=await a.repo.loadGame('save-a');
    const put=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw new Error('mock lifecycle transaction failure');return put.apply(this,args);});
    await expect(a.repo.commitTurn(submission(done.draft))).rejects.toThrow();spy.mockRestore();
    expect(await a.repo.loadGame('save-a')).toEqual(before);expect((await a.repo.load('save-a')).events['due-event']).toBeDefined();
    const saved=await a.repo.commitTurn(submission(done.draft));expect(saved.state.events['due-event']).toBeUndefined();expect(saved.state.journal).toHaveLength(2);
  });
  it.each(['world-disabled','variables-failed'] as const)('%s不能结算或清理到期事件，不额外请求',async(mode)=>{
    const a=await dueFixture(),before=await a.repo.load('save-a'),t=dueTransport(a,mode==='variables-failed');
    if(mode==='world-disabled')a.settings.runtime.useWorldStage=false;
    const runner=coordinator(a.repo,t.fetcher);
    if(mode==='variables-failed')await expect(runner.generate(a)).rejects.toThrow();
    else expect((await runner.generate(a)).status).toBe('skipped');
    expect(t.calls.map(c=>c.stage)).toEqual(['story','variables']);expect(await a.repo.load('save-a')).toEqual(before);
    const pending=await a.repo.loadDraft('save-a');if(!pending)throw Error('missing draft');
    await expect(a.repo.commitTurn(submission(pending))).rejects.toThrow();expect(await a.repo.load('save-a')).toEqual(before);
  });
});


describe('真实Runtime与协调器的非空现场记录、承接与行为回写',()=>{
  it('现场事件从已有Story记录并自动候选化，不能修改人物；提交重载保留相同稳定事件',async()=>{
    const a=await fixture('regular'),before=await a.repo.load('save-a');
    const text='林舟在社区与同事发生争执。';
    const t=transport(()=>block(set('worldClock','2026-10-18T08:10:00+08:00')),(ctx)=>({...worldResult(),eventCommands:[{
      type:'SaveEvent',commandId:'record-scene',evidence:proof({kind:'established',sources:['story:current'],fact:text}),
      event:{...event('scene-dispute'),title:text,backgroundText:text,goalText:text,actorRefs:[{kind:'protagonist',id:'hero'}],
        status:'active',estimatedEndAt:'2026-10-18T09:00:00+08:00',visibility:'known',sourceTurnIds:[string(record(ctx.TURN_CONTEXT).turnId)],
        continuation:{direction:'end',reason:'目前先记录，尚无新的承接需要'}},
    }]}),()=>({narrative:text,guide:[]}));
    const done=await coordinator(a.repo,t.fetcher).generate(a);
    expect(t.calls.map(c=>c.stage)).toEqual(['story','variables','world']);expect(await a.repo.load('save-a')).toEqual(before);
    const saved=await a.repo.commitTurn(submission(done.draft,''));
    expect(saved.state.events['scene-dispute'].status).toBe('active');expect(saved.state.npc).toEqual(before.npc);
    expect(await a.repo.load('save-a')).toEqual(saved.state);expect(saved.draft.userInput).toBe('');
  });
  it.each(['declined','left','interrupted'] as const)('World排队→下一幕呈现→%s后同事件改排程，三个回合每阶段仅一次请求',async(action)=>{
    const a=await fixture('regular');
    const cue='值班室来电，请你说明情况。';
    const t=transport(()=>block(set('worldClock','2026-10-18T08:10:00+08:00')),(ctx)=>({...worldResult(),eventCommands:[{
      type:'SaveEvent',commandId:'queue-entry',evidence:proof(),event:{...event('contact'),actorRefs:[{kind:'npc',id:'npc-a'}],
        status:'active',estimatedEndAt:'2026-10-18T08:05:00+08:00',sourceTurnIds:[string(record(ctx.TURN_CONTEXT).turnId)],
        continuation:{direction:'protagonist',reason:'材料清点后需要听取当事人意见',entry:{channel:'电话',cue}}},
    }]}));
    const first=await coordinator(a.repo,t.fetcher).generate(a);const s1=await a.repo.commitTurn(submission(first.draft,'接听电话'));
    expect(s1.state.events.contact.protagonistEntry?.status).toBe('pending');expect(s1.draft.story).toBeUndefined();
    const second=transport(()=>block(),()=>worldResult(),ctx=>{
      const entry=record(array(ctx.EVENT_ENTRIES)[0]);expect(entry.cue).toBe(cue);
      expect(JSON.stringify(ctx)).not.toContain('既有预约安排');
      return {narrative:cue,guide:[{group:'event',observedFact:'实际收到电话',textEvidence:cue,eventInteraction:{eventId:'contact',entryId:entry.entryId,action:'presented'}}]};
    });
    const out2=await coordinator(a.repo,second.fetcher).generate({...a,draft:s1.draft});
    expect((await a.repo.load('save-a')).events.contact.protagonistEntry?.status).toBe('pending');
    const s2=await a.repo.commitTurn(submission(out2.draft,'说明我的实际选择'));
    expect(s2.state.events.contact.protagonistEntry?.status).toBe('presented');expect(s2.state.events.contact.status).toBe('active');
    const text=action==='declined'?'林舟明确拒绝继续约谈。':action==='left'?'林舟结束参与并离开会谈。':'林舟实际切断了本次会谈联络。';
    const third=transport(()=>block(set('worldClock','2026-10-18T08:20:00+08:00')),ctx=>{
      const current=record(record(ctx.OFFSCREEN_STATE).events).contact;
      expect(record(record(current).protagonistEntry).status).toBe(action);
      return {...worldResult(),eventCommands:[{type:'SaveEvent',commandId:'respond-choice',event:{...record(current),status:'blocked',estimatedEndAt:'2026-10-19T08:00:00+08:00',sourceTurnIds:[...s2.state.events.contact.sourceTurnIds,string(record(ctx.TURN_CONTEXT).turnId)],
        continuation:{direction:'end',reason:'本次入场已经结束，原单位另行处理剩余调查'}},evidence:proof({at:'2026-10-18T08:15:00+08:00',sources:['event:contact','story:current'],fact:text,
          decision:{targetId:'contact',status:'blocked',reason:'本幕实际选择改变后续接触安排',result:text,conditionsSatisfied:false,continues:true}})}]};
    },()=>({narrative:text,guide:[{group:'event',observedFact:'实际退出反馈',textEvidence:text,eventInteraction:{eventId:'contact',entryId:s2.state.events.contact.protagonistEntry!.id,action}}]}));
    const out3=await coordinator(a.repo,third.fetcher).generate({...a,draft:s2.draft});const s3=await a.repo.commitTurn(submission(out3.draft,''));
    expect(s3.state.events.contact).toMatchObject({status:'blocked',protagonistEntry:{status:action},continuation:{direction:'end'}});
    expect(s3.state.npc).toEqual(s1.state.npc);expect((await a.repo.load('save-a')).events.contact).toEqual(s3.state.events.contact);
    expect((await a.repo.commitTurn(submission(out3.draft,''))).replayed).toBe(true);
    expect([...t.calls,...second.calls,...third.calls].map(c=>c.stage)).toEqual(['story','variables','world','story','variables','world','story','variables','world']);
  });
});

it('真实Runtime允许入场延后到下一幕，未处理回执在提交和重载后仍pending',async()=>{
 const a=await fixture('regular'),cue='接待处来电，请你确认是否参加。';
 const first=transport(()=>block(set('worldClock','2026-10-18T08:10:00+08:00')),ctx=>({...worldResult(),eventCommands:[{type:'SaveEvent',commandId:'entry-to-handle',evidence:'来电',event:{...event('call'),status:'active',actorRefs:[{kind:'npc',id:'npc-a'}],estimatedEndAt:'2026-10-18T08:05:00+08:00',sourceTurnIds:[string(record(ctx.TURN_CONTEXT).turnId)],continuation:{direction:'protagonist',reason:'需要当事人答复',entry:{channel:'电话',cue}}}}]}));
 const ready=await coordinator(a.repo,first.fetcher).generate(a),saved=await a.repo.commitTurn(submission(ready.draft,'继续休息'));
 const quiet=transport(()=>block(),()=>worldResult(),()=>({narrative:'主角继续休息，没有处理来电。',guide:[]}));
 const quietReady=await coordinator(a.repo,quiet.fetcher).generate({...a,draft:saved.draft}),waiting=await a.repo.commitTurn(submission(quietReady.draft,'接听来电'));
 expect((await a.repo.load('save-a')).events.call.protagonistEntry?.status).toBe('pending');expect(quiet.calls.map(c=>c.stage)).toEqual(['story','variables','world']);
 const next=transport(()=>block(),()=>worldResult(),ctx=>{const entry=record(array(ctx.EVENT_ENTRIES)[0]);return {narrative:cue,guide:[{group:'event',observedFact:'实际接听',textEvidence:cue,eventInteraction:{eventId:'call',entryId:entry.entryId,action:'presented'}}]}});
 const completed=await coordinator(a.repo,next.fetcher).generate({...a,draft:waiting.draft});expect((await a.repo.load('save-a')).events.call.protagonistEntry?.status).toBe('pending');
 const committed=await a.repo.commitTurn(submission(completed.draft,''));expect(committed.state.events.call.protagonistEntry?.status).toBe('presented');expect((await a.repo.commitTurn(submission(completed.draft,''))).replayed).toBe(true);
});

// 本轮只依据已确认的错误形态构造中性 Mock，不冒充尚未取得的实机原文/存档。
it.each(['knowledge-shape', 'timeline-object', 'organization-history', 'interaction-time'] as const)(
  '协议可靠性 %s：真实请求失败保留Story，明确重试后Variables→World→Commit→重载', async failure => {
    const a = await fixture('opening'), before = await a.repo.load('save-a');
    let corrected = false;
    const t = transport(() => block([
      set('protagonist.emotionText', '从容'),
      ...(failure === 'interaction-time' ? [set('npc[scene].lastInteractionAt', corrected ? openingEnd : '2015-07-09T08:05:00+08:00')] : []),
      `push npc[scene].knownInformation = ${JSON.stringify(!corrected && failure === 'knowledge-shape'
        ? { text: '收到值班安排', source: '同事通知', learnedAt: openingEnd }
        : { text: '收到值班安排', knowledgeKind: 'reported', knowledgeSource: '同事通知', visibility: 'npc_private' })}`,
    ].join('\n')), context => ({
      ...worldResult(),
      worldCommands: [{ type: 'CreateOrganization', commandId: 'community-org', evidence: '登记社区服务团队', organization: {
        id: 'org-community', kind: 'civil', name: '社区服务团队', description: '社区日常协调', protagonistRelation: '暂无往来',
        relationHistory: !corrected && failure === 'organization-history' ? ['提前填写的历史'] : [], keyNpcIds: [], currentTaskIds: [], activities: [],
      } }],
      eventCommands: [{ type: 'SaveEvent', commandId: 'community-result', evidence: '社区完成协调', event: {
        ...event('routine-finished'), title: '社区日常协调', startAt: initialAt, estimatedEndAt: openingEnd,
        status: 'resolved', resolvedAt: openingEnd, resolutionText: '已完成日常协调', outcome: 'success', impact: 'significant',
        actorRefs: [{ kind: 'organization', id: 'org-community' }], sourceTurnIds: [record(context.TURN_CONTEXT).turnId],
        continuation: { direction: 'end', reason: '无后续追踪需要' },
      } }],
      ...(!corrected && failure === 'timeline-object' ? { timelineCandidates: [{eventId:'routine-finished'}] } : {}),
    }));
    const runner = coordinator(a.repo, t.fetcher);
    await expect(runner.generate(a)).rejects.toMatchObject({ code: failure === 'organization-history' ? 'permission' : failure === 'interaction-time' ? 'time_data' : 'schema_fields' });
    const failed = await a.repo.loadDraft('save-a');
    expect(failed?.story).toBeTruthy(); expect(failed?.world).toBeUndefined();
    const variableFailure = failure === 'knowledge-shape' || failure === 'interaction-time';
    expect(Boolean(failed?.variables)).toBe(!variableFailure);
    expect(t.calls.map(call => call.stage)).toEqual(variableFailure ? ['story', 'variables'] : ['story', 'variables', 'world']);
    expect(await a.repo.load('save-a')).toEqual(before);
    corrected = true;
    const outcome = await runner.generate({ ...a, draft: failed! });
    expect(outcome.status).toBe('complete'); expect(outcome.draft.story).toEqual(failed!.story);
    expect(t.calls.map(call => call.stage)).toEqual(variableFailure ? ['story', 'variables', 'variables', 'world'] : ['story', 'variables', 'world', 'world']);
    const request = t.calls.find(call => call.stage === 'world')!.context;
    expect(record(record(request.COMMAND_CATALOG).outputFields).timelineCandidates).toBeUndefined();
    const receipt = await a.repo.commitTurn(submission(outcome.draft, '继续工作'));
    expect(receipt.state.npc.scene.knownInformation).toEqual([{ text: '[转述]收到值班安排', source: '同事通知', learnedAt: openingEnd }]);
    expect(receipt.state.npc['npc-a'].memories).toEqual(before.npc['npc-a'].memories);
    expect(receipt.state.organizations['org-community'].relationHistory).toEqual([]);
    expect(receipt.state.events['routine-finished'].status).toBe('resolved'); expect(receipt.state.timeline).toEqual([]);
    expect(receipt.state.worldClock).toBe(openingEnd); expect(receipt.state.journal).toHaveLength(1);
    expect((await a.repo.commitTurn(submission(outcome.draft, '继续工作'))).replayed).toBe(true);
    expect(await a.repo.load('save-a')).toEqual(receipt.state); expect(t.calls).toHaveLength(4);
  },
);

it.each(['opening', 'regular'] as const)('背包V2 %s：真实请求创建/更新资料，候选→Commit→重载，下一回合赠送', async mode => {
  const a = await fixture(mode), before = await a.repo.load('save-a');
  const owner = { kind: 'protagonist', id: 'hero' };
  const t = transport(() => block([
    set('items[coat].purchase', { account: 'cash', price: 2500, item: { name: '防寒外套', category: 'top', quantity: 1, ownerRef: owner,
      description: '黑色加厚外套', referenceValue: 18000, conditionText: '袖口略旧', itemDetails: { material: '棉布', size: 'L' } } }),
    set('items[coat].referenceValue', 16000), set('items[coat].questItem', true),
    set('protagonist.currentWear', { topItemId: 'coat', accessoryItemIds: [] }),
    set('items[torch]', { name: '手电', category: 'tool', quantity: 2, conditionText: '可用', ownerRef: owner, referenceValue: null, itemDetails: { purpose: '照明' } }),
  ].join('\n')));
  const completed = await coordinator(a.repo, t.fetcher).generate(a);
  expect(t.calls.map(c => c.stage)).toEqual(['story', 'variables', 'world']);
  expect(JSON.stringify(t.calls[1].context.TEXT_COMMAND_CATALOG)).toContain('items[id].referenceValue');
  expect(JSON.stringify(t.calls[2].context.VARIABLE_RESULT)).toContain('黑色加厚外套');
  expect(await a.repo.load('save-a')).toEqual(before);
  const projected = projectTurn(before, completed.draft);
  const committed = await a.repo.commitTurn(submission(completed.draft, '把外套送给同事'));
  expect(committed.state.items).toEqual(projected.items); expect(committed.state.economy.cash).toBe(before.economy.cash! - 2500);
  expect(committed.state.items.coat).toMatchObject({ description: '黑色加厚外套', referenceValue: 16000, questItem: true, itemDetails: { material: '棉布', size: 'L' } });
  expect((await a.repo.commitTurn(submission(completed.draft, '把外套送给同事'))).replayed).toBe(true);
  expect(await a.repo.load('save-a')).toEqual(committed.state);
  const next = transport(() => block([
    set('items[coat].conditionText', '已经洗净'),
    set('items[coat].itemDetails', { material: '棉布', size: 'L', warmth: '适合冬季' }),
    set('items[coat].transfer', { from: owner, to: { kind: 'npc', id: 'npc-a' } }),
    'add items[torch].quantity = -1',
  ].join('\n')));
  const updated = await coordinator(a.repo, next.fetcher).generate({ ...a, draft: committed.draft });
  const saved = await a.repo.commitTurn(submission(updated.draft, '继续行动'));
  expect(saved.state.items.coat.ownerRef).toEqual({ kind: 'npc', id: 'npc-a' });
  expect(saved.state.items.coat.itemDetails).toEqual({ material: '棉布', size: 'L', warmth: '适合冬季' });
  expect(saved.state.items.coat.referenceValue).toBe(16000); expect(saved.state.items.torch.quantity).toBe(1);
  expect(saved.state.protagonist.currentWear.topItemId).toBeUndefined(); expect(saved.state.economy).toEqual(committed.state.economy);
  expect(await a.repo.load('save-a')).toEqual(saved.state); expect(next.calls.map(c => c.stage)).toEqual(['story', 'variables', 'world']);
});

it.each(['opening','regular'] as const)('新历史协议%s：真实三阶段生成独立历史、并行任务、参与者变化，原子保存后继续',async mode=>{
 const a=await fixture(mode),before=await a.repo.load('save-a');
 const t=transport(()=>block([set('locations[new-office]',{name:'办公室'}),set('protagonist.locationId','new-office')].join('\n')),ctx=>{
  const clock=mode==='opening'?openingEnd:before.worldClock;
  return {...worldResult(),worldCommands:[{type:'RecordHistory',commandId:'past',evidence:'人物透露大学经历',entry:{id:'past',title:'大学时期的合作',summary:'同事声称当时发生合作分歧',occurredTimeText:'大学时期',knowledgeKind:'reported',sourceRef:{kind:'npc',id:'npc-a'}}}],
    taskCommands:['planned','active','blocked'].map((status,i)=>({type:'SaveTask',commandId:'parallel-'+i,evidence:'独立职责',task:{...task('parallel-'+i),goal:'职责'+i,actorRef:{kind:'npc',id:'npc-a'},startAt:clock,dueAt:undefined,completionCondition:'相应事项处理完毕',status}})),
    eventCommands:[{type:'SaveEvent',commandId:'plan',evidence:'安排后续',event:{...event('plan'),startAt:clock,estimatedEndAt:'2030-01-01T00:00:00+08:00',impact:'minor',actorRefs:[{kind:'npc',id:'npc-a'}],sourceTurnIds:[string(record(ctx.TURN_CONTEXT).turnId)]}}]};
 });
 const generated=await coordinator(a.repo,t.fetcher).generate(a);expect(t.calls.map(c=>c.stage)).toEqual(['story','variables','world']);expect(await a.repo.load('save-a')).toEqual(before);
 const projection=projectTurn(before,generated.draft,[...generated.draft.world!.result.worldCommands,...generated.draft.world!.result.taskCommands,...generated.draft.world!.result.eventCommands]);
 const input=submission(generated.draft,'继续交谈'),put=IDBObjectStore.prototype.add;
 vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name==='turnReceipts')throw new DOMException('Mock rollback','QuotaExceededError');return put.call(this,value,key)});
 await expect(a.repo.commitTurn(input)).rejects.toThrow();expect(await a.repo.load('save-a')).toEqual(before);vi.restoreAllMocks();
 const saved=await a.repo.commitTurn(input);expect(saved.state.timeline).toEqual(projection.timeline);expect(saved.state.tasks).toEqual(projection.tasks);expect(saved.state.events).toEqual(projection.events);expect(saved.state.npc).toEqual(before.npc);
 expect((await a.repo.commitTurn(input)).replayed).toBe(true);expect(await a.repo.load('save-a')).toEqual(saved.state);expect(t.calls).toHaveLength(3);
 const later=transport(()=>block(),ctx=>{expect(record(ctx.OFFSCREEN_STATE).history).toEqual(saved.state.timeline);return worldResult();});
 const next=await coordinator(a.repo,later.fetcher).generate({...a,draft:saved.draft});const committed=await a.repo.commitTurn(submission(next.draft,''));expect(committed.state.turnNumber).toBe(saved.state.turnNumber+1);expect(committed.state.timeline).toEqual(saved.state.timeline);expect(later.calls).toHaveLength(3);
});
