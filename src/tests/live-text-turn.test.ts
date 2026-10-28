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
function transport(reply:(context:Record<string,unknown>)=>string, world:(context:Record<string,unknown>)=>unknown = ()=>worldResult()) {
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
      return envelope(`<thinking>创作提纲：保持当前事实连续。</thinking><正文>主角在社区与同事会面，收到报酬，购买手机并交给同事。</正文><短期记忆>在社区完成会面和交付。</短期记忆><变量规划>${JSON.stringify(guides)}</变量规划>`,true);
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
  it('正文现场任务/事件保留旧JSON能力，文本创建及更新后按原Commit规则结算',async()=>{
    const a=await fixture('regular'),at='2026-10-18T08:10:00+08:00';
    const {id:_task,...sceneTask}=task('scene-task');void _task;
    const {id:_event,...sceneEvent}=event('scene-event');void _event;
    const t=transport(()=>block([set('worldClock',at),
      set('tasks[scene-task]',{...sceneTask,status:'active'}),
      set('events[scene-event]',{...sceneEvent,status:'active',visibility:'known',sourceTurnIds:[a.draft.turnId]}),
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
    const result=await parseTextVariables('<说明>NPC内部秘密，消费一百万元；test-live-secret</说明><命令></命令>',state,draft);
    expect(result.commands).toHaveLength(1);expect(result.unresolved).toEqual(['模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。']);
    expect(JSON.stringify(result)).not.toMatch(/一百万元|NPC内部秘密|test-live-secret/);
  });
  it('命令字符串里的说明标签只是值，不能触发非执行说明提示',async()=>{
    const a=await fixture('regular'),state=await a.repo.load('save-a');const draft=rerollStory(a.draft,{turnKind:'regular',narrative:'会面',summary:'会面',variableGuide:[]});
    const result=await parseTextVariables('<命令>set protagonist.emotionText = "想到<说明>中的句子"</命令>',state,draft);
    expect(result.unresolved).toEqual([]);expect(result.commands).toHaveLength(1);
  });
});
