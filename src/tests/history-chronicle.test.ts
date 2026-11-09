import { afterEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { TimelineEntrySchema } from '../domain/events/schema';
import { projectTurn } from '../domain/turnProjection';
import { parseWorld, parseVariables } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { chronicle, historyCommand, historyEntry } from './fixtures/historyV2';
import { event, gameTime, task } from './fixtures/game';
import { worldDraft, worldState, worldResult, projectedTime } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';

function scenario() {
  const state = worldState(), draft = worldDraft();
  const live = { ...event('investigation'), status: 'active' as const, actorRefs: [{kind:'npc' as const,id:'npc-a'}],
    estimatedEndAt: projectedTime, impact: 'minor' as const };
  state.events[live.id] = live;
  const ended = { ...live, status: 'resolved' as const, resolvedAt: projectedTime, resolutionText: '调查结束，修订了管理制度。', outcome: 'success' as const };
  const archive = historyCommand('investigation-history', { ...chronicle('investigation-concluded'), category:'world',scope:'organization',scopeText:'城市交通集团',
    basis:'event_result',time:{precision:'instant',at:live.startAt},endTime:{precision:'instant',at:projectedTime} });
  archive.entry.eventId = live.id;
  const finish: DomainCommand = {type:'SaveEvent',commandId:'finish',evidence:'调查已经实际结束',event:ended};
  return { state, draft, live, ended, archive, finish };
}
const result = (commands: DomainCommand[], eventCommands: DomainCommand[] = []) => ({...worldResult(commands),eventCommands});

it('同轮先RecordHistory后SaveEvent：最终结案状态支持归档，定位实际开始而非预计/结束时间', () => {
  const a=scenario(), before=structuredClone(a.state);
  const parsed=parseWorld(JSON.stringify(result([a.archive],[a.finish])),a.state,a.draft);
  const next=projectTurn(a.state,a.draft,[...parsed.worldCommands,...parsed.eventCommands]);
  expect(next.timeline[0].chronicle?.time).toEqual({precision:'instant',at:gameTime});
  expect(next.timeline[0].chronicle?.endTime).toEqual({precision:'instant',at:projectedTime});
  expect(next.events.investigation.status).toBe('resolved');
  expect(next.npc).toEqual(before.npc);expect(a.state).toEqual(before);
});
it.each(['scheduled','active','blocked'] as const)('世界%s事件不能提前归档，但普通史料仍可记录', status=>{
  const a=scenario();a.state.events.investigation={...a.live,status,estimatedEndAt:'2026-10-19T08:00:00+08:00'};
  expect(()=>parseWorld(JSON.stringify(result([a.archive])),a.state,a.draft)).toThrow();
  const ordinary={...a.archive,entry:{...a.archive.entry,chronicle:undefined,knowledgeKind:'reported' as const}};
  expect(()=>parseWorld(JSON.stringify(result([ordinary])),a.state,a.draft)).not.toThrow();
});
it('主角决定当时记录，不要求计划目标已完成；正文词语不参与重大性审批',()=>{
  const state=worldState(),draft=worldDraft();const command=historyCommand();
  command.entry.summary='决定创业，尚未成立公司，预计未来可能成功。';
  const output=parseWorld(JSON.stringify(result([command])),state,draft);
  const next=projectTurn(state,draft,output.worldCommands);expect(next.timeline).toHaveLength(1);expect(next.protagonist).toEqual(state.protagonist);
});
it('世界影响范围由模型声明且必填，不使用impact阈值',()=>{
  const a=scenario();expect(a.live.impact).toBe('minor');
  expect(()=>parseWorld(JSON.stringify(result([a.archive],[a.finish])),a.state,a.draft)).not.toThrow();
  const raw=JSON.parse(JSON.stringify(a.archive));delete raw.entry.chronicle.scope;
  expect(DomainCommandSchema.safeParse(raw).success).toBe(false);
});
it('历史旧事无事件实体仍可归档，不造预计时间、任务或实体',()=>{
  const command=historyCommand('old-world',{...chronicle('old-world',{precision:'season',year:2021,season:'winter',text:'2021年冬季'}),category:'world',scope:'country',scopeText:'架空国家',basis:'historical_event',endTime:{precision:'year',year:2021}});
  const state=worldState(),draft=worldDraft(),parsed=parseWorld(JSON.stringify(result([command])),state,draft);
  const next=projectTurn(state,draft,parsed.worldCommands);expect(next.events).toEqual({});expect(next.timeline[0].occurredAt).toBeUndefined();
});
it('未知时间保留待考，时间范围与已知发生时间不能冲突或在未来',()=>{
  const state=worldState(),draft=worldDraft();
  expect(()=>parseWorld(JSON.stringify(result([historyCommand('unknown',chronicle('unknown',{precision:'unknown',text:'青年时期'}))])),state,draft)).not.toThrow();
  for(const time of [
    {precision:'year' as const,year:2030},
    {precision:'range' as const,from:{precision:'day' as const,date:'2021-05-02'},to:{precision:'day' as const,date:'2021-05-01'}},
  ]) expect(()=>parseWorld(JSON.stringify(result([historyCommand('bad',chronicle('bad',time))])),state,draft)).toThrow();
  const conflict=historyCommand('conflict',chronicle('conflict',{precision:'year',year:2021}));conflict.entry.occurredAt=gameTime;
  expect(()=>parseWorld(JSON.stringify(result([conflict])),state,draft)).toThrow();
});
it('仅年/月份与冬季的展示位置不会把已发生记录判成未来精确日期',()=>{
  const state=worldState(),draft=worldDraft();
  for(const time of [{precision:'month' as const,year:2026,month:10},{precision:'year' as const,year:2026},{precision:'season' as const,year:2026,season:'winter' as const}])
    expect(()=>parseWorld(JSON.stringify(result([historyCommand('partial',chronicle('partial',time))])),state,draft)).not.toThrow();
});
it('未开始即取消不可假称已发生；撤销决定可独立记录，时间使用撤销时刻',()=>{
  const a=scenario();a.live.startAt='2026-10-20T08:00:00+08:00';a.live.estimatedEndAt='2026-10-20T09:00:00+08:00';a.live.status='active';
  a.state.events.investigation={...a.live,status:'scheduled'};
  const cancelled:DomainCommand={...a.finish,event:{...a.live,status:'cancelled',resolvedAt:projectedTime,resolutionText:'撤销原定计划',outcome:'cancelled'}};
  const c=a.archive.entry.chronicle!;if(c.category!=='world')throw Error();c.time={precision:'instant',at:a.live.startAt};
  expect(()=>parseWorld(JSON.stringify(result([a.archive],[cancelled])),a.state,a.draft)).toThrow();
  c.basis='cancellation_decision';c.time={precision:'instant',at:projectedTime};
  expect(()=>parseWorld(JSON.stringify(result([a.archive],[cancelled])),a.state,a.draft)).not.toThrow();
});
it('Variables已合法完成的现场事件可由World只记录历史，无终态二次写入',()=>{
  const a=scenario();a.state.events.investigation={...a.live,actorRefs:[{kind:'protagonist',id:'hero'}]};
  a.draft.variables!.result.commands.push({...a.finish,event:{...a.ended,actorRefs:[{kind:'protagonist',id:'hero'}]}});
  const parsed=parseWorld(JSON.stringify(result([a.archive])),a.state,a.draft);
  expect(parsed.eventCommands).toEqual([]);expect(projectTurn(a.state,a.draft,parsed.worldCommands).timeline).toHaveLength(1);
  expect(()=>parseVariables(JSON.stringify({commands:[a.archive],rejectedSuggestions:[],unresolved:[]}),a.state,a.draft)).toThrow();
});
it('双视角共享里程碑与时刻，重复同类和时间冲突拒绝',()=>{
  const a=scenario(),hero=historyCommand('hero-history',chronicle('investigation-concluded'));
  a.archive.entry.chronicle!.relations=[{kind:'parallel',entryId:hero.entry.id}];hero.entry.chronicle!.relations=[{kind:'parallel',entryId:a.archive.entry.id}];
  expect(()=>parseWorld(JSON.stringify(result([a.archive,hero],[a.finish])),a.state,a.draft)).not.toThrow();
  expect(()=>parseWorld(JSON.stringify(result([a.archive,hero,historyCommand('duplicate',chronicle('investigation-concluded'))],[a.finish])),a.state,a.draft)).toThrow();
  hero.entry.chronicle!.time={precision:'instant',at:projectedTime};
  expect(()=>parseWorld(JSON.stringify(result([a.archive,hero],[a.finish])),a.state,a.draft)).toThrow();
});
it('更正/新进展追加独立节点；不改旧记录，关系环/自引用/不存在引用拒绝',()=>{
  const state=worldState(),first=historyCommand();const before=commitCommands(state,'first',0,[first]);
  const nextCommand=historyCommand('correction',chronicle('correction'));nextCommand.entry.chronicle!.relations=[{kind:'corrects',entryId:first.entry.id}];
  const next=commitCommands(before,'second',before.revision,[nextCommand]);expect(next.timeline[0]).toEqual(before.timeline[0]);
  expect(commitCommands(next,'second',before.revision,[nextCommand])).toEqual(next);
  for(const id of ['missing','correction']) {const invalid=structuredClone(nextCommand);invalid.entry.chronicle!.relations=[{kind:'follows',entryId:id}];expect(()=>commitCommands(before,'bad',before.revision,[invalid])).toThrow();}
  const second=historyCommand('two',chronicle('two'));first.entry.chronicle!.relations=[{kind:'follows',entryId:'two'}];second.entry.chronicle!.relations=[{kind:'corrects',entryId:first.entry.id}];
  expect(()=>commitCommands(state,'cycle',0,[first,second])).toThrow();
});
it('来源回合、实体和长内容均结构性拒绝，不部分改动',()=>{
  const state=worldState(),draft=worldDraft(),before=structuredClone(state);
  for(const alter of [
    (c:ReturnType<typeof historyCommand>)=>{c.entry.chronicle!.supportingTurnIds=['invented-turn'];},
    (c:ReturnType<typeof historyCommand>)=>{c.entry.actorRefs=[{kind:'npc',id:'missing'}];},
    (c:ReturnType<typeof historyCommand>)=>{c.entry.chronicle!.narrative='甲'.repeat(3001);},
  ]) {const c=historyCommand();alter(c);expect(()=>parseWorld(JSON.stringify(result([c])),state,draft)).toThrow();expect(state).toEqual(before);}
  const c=historyCommand();c.entry.chronicle!.supportingTurnIds=[draft.turnId];expect(()=>parseWorld(JSON.stringify(result([c])),state,draft)).not.toThrow();
});
it('归档后同轮调查后继与任务继续成立，旧史不参与排程或认知广播',()=>{
  const a=scenario();const follow={...a.live,id:'followup',startAt:projectedTime,estimatedEndAt:'2026-10-19T08:00:00+08:00',predecessorEventIds:['investigation']};
  const raw=result([a.archive],[a.finish,{type:'SaveEvent',commandId:'followup',evidence:'后续调查',event:follow}]);
  raw.taskCommands=[{type:'SaveTask',commandId:'job',evidence:'后台职责',task:{...task('followup-task'),actorRef:{kind:'npc',id:'npc-a'},startAt:projectedTime,dueAt:'2026-10-19T08:00:00+08:00',linkedEventId:'followup'}}];
  const parsed=parseWorld(JSON.stringify(raw),a.state,a.draft),next=projectTurn(a.state,a.draft,[...parsed.worldCommands,...parsed.taskCommands,...parsed.eventCommands]);
  expect(next.events.followup.linkedTaskIds).toEqual(['followup-task']);expect(next.events.investigation.status).toBe('resolved');expect(next.npc).toEqual(a.state.npc);
});
it('旧V6/普通历史及旧候选继续合法；旧strict客户端会拒绝新字段而非删字段覆盖',()=>{
  const state=worldState(),old={...historyEntry('old'),chronicle:undefined,knowledgeKind:'reported' as const};state.timeline=[old];
  expect(GameStateSchema.parse(state).timeline[0].chronicle).toBeUndefined();
  const legacy=TimelineEntrySchema.omit({chronicle:true});expect(legacy.safeParse(JSON.parse(JSON.stringify(old))).success).toBe(true);
  const modern=historyEntry('new');expect(legacy.safeParse(modern).success).toBe(false);expect(modern.chronicle).toBeDefined();
});

const repositories:SaveRepository[]=[];afterEach(()=>repositories.splice(0).forEach(repo=>repo.close()));
it('真实Repository：开局→普通历史→双节点原子Commit→重载→撤回→重载，无旧历史复活',async()=>{
  const factory=new IDBFactory(),repo=await SaveRepository.open('history-v2',factory);repositories.push(repo);await repo.create(worldState());
  await repo.commitTurn(submission(await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()}),''));
  const before=await repo.load('save-a'),draftBefore=await repo.loadDraft('save-a');
  await repo.bindTurnAction(draftBefore!,'决定创办阅览室',true,true);
  const hero=historyCommand(),world=historyCommand('world-pair',{...chronicle('milestone-one'),category:'world',scope:'region',scopeText:'社区',basis:'historical_event',endTime:{precision:'instant',at:gameTime}});
  hero.entry.chronicle!.relations=[{kind:'parallel',entryId:world.entry.id}];
  const candidate=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult([world,hero])});
  const committed=await repo.commitTurn(submission(candidate,''));expect(committed.state.timeline).toHaveLength(2);
  expect((await repo.commitTurn(submission(candidate,''))).replayed).toBe(true);
  const loaded=await repo.load('save-a');expect(loaded.timeline).toEqual(committed.state.timeline);
  const restored=await repo.undoTurn({saveId:'save-a',expectedRevision:loaded.revision,expectedDraft:await repo.loadDraft('save-a'),operationId:'undo-history'});
  expect(restored.input).toBe('决定创办阅览室');expect(restored.state).toEqual({...before,revision:loaded.revision+1,updatedAt:restored.state.updatedAt});
  await expect(repo.commitTurn(submission(candidate,''))).rejects.toThrow();
  const reopened=await SaveRepository.open('history-v2',factory);repositories.push(reopened);
  expect((await reopened.load('save-a')).timeline).toEqual(before.timeline);
  expect((await reopened.exportRaw('save-a')).records.turnUndo).toHaveLength(0);
});
it('伪造validated候选仍在正式Commit拒绝，Story/草稿保留，正式存档完全不变',async()=>{
  const repo=await SaveRepository.open('history-invalid',new IDBFactory());repositories.push(repo);await repo.create(worldState());
  const bad=historyCommand();bad.entry.chronicle!.supportingTurnIds=['missing'];
  const candidate=await completeDraft(repo,{world:worldResult([bad])}),before=await repo.load('save-a');
  await expect(repo.commitTurn(submission(candidate,''))).rejects.toThrow();
  expect(await repo.load('save-a')).toEqual(before);expect((await repo.loadDraft('save-a'))?.story).toEqual(candidate.story);
});
it.each([['fact','established'],['statement','reported'],['rumor','suspected'],['inference','suspected']] as const)('纪事区分%s，保留原认知分类兼容，结构冲突明确拒绝',(nature,knowledgeKind)=>{
 const cmd=historyCommand();cmd.entry.chronicle!.nature=nature;cmd.entry.knowledgeKind=knowledgeKind;
 expect(()=>parseWorld(JSON.stringify(result([cmd])),worldState(),worldDraft())).not.toThrow();
 cmd.entry.knowledgeKind=knowledgeKind==='established'?'reported':'established';
 expect(()=>parseWorld(JSON.stringify(result([cmd])),worldState(),worldDraft())).toThrow();
});
