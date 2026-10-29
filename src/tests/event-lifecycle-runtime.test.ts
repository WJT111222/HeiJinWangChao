import { describe, expect, it } from 'vitest';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { commitCommands } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { WorldEventSchema } from '../domain/events/schema';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { worldDraft, worldState } from './fixtures/world';
import { event, task, npc } from './fixtures/game';

describe('事件生命周期旧设计失败复现',()=>{
  it('条件不能代替新事件预计终止时间，目录及新事件Schema必须声明必填',()=>{
    const {estimatedEndAt:_old,...incident}=event();void _old;
    expect(WorldEventSchema.safeParse({...incident,completionCondition:'调查完成'}).success).toBe(false);
    expect(textVariableCatalog().entries.some(e=>e.path==='events[id]')).toBe(false);
    expect(textVariableCatalog().entries.find(e=>e.path==='events[id].sceneState')?.valueSchema).toHaveProperty('required',expect.arrayContaining(['status']));
    expect(JSON.stringify(commandCatalog('world').schema)).toContain('estimatedEndAt');
  });
  it('原始旧档没有事件/任务时间规划，合法现场更新仍能模拟',async()=>{
    const state=worldState();
    const {estimatedEndAt:_end,...incident}=event();void _end;
    const {dueAt:_due,...job}=task();void _due;
    state.events[incident.id]=incident;state.tasks[job.id]=job;
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    const draft=worldDraft(false,'opening');
    const result=await parseTextVariables('<命令>set protagonist.emotionText = "平静"</命令>',state,draft);
    expect(result.commands[0].type).toBe('UpdateProtagonist');
    expect(commitCommands(state,draft.turnId,0,result.commands).protagonist.emotionText).toBe('平静');
  });
});

import { parseWorld } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { worldEventSchedule } from '../domain/events/schedule';
import { projectTurn } from '../domain/turnProjection';
import { worldSources } from '../services/validation/worldEvidence';
import { playerView } from '../ui/panels/playerView';
import { migrateSave } from '../services/storage/migrations';
import { proof, worldResult, projectedTime, actionTime } from './fixtures/world';
import type { DomainCommand } from '../domain/commands';
import type { WorldEvent } from '../domain/events/schema';

function ongoing(id='investigation'):WorldEvent {
  return {...event(id),title:'整理诊室',backgroundText:'值班间隙清点诊室物资',goalText:'完成清点',
    estimatedEndAt:actionTime,actorRefs:[{kind:'npc',id:'npc-a'}],impact:'minor',status:'active'};
}
function prepared(values:WorldEvent[]=[ongoing()]) {
  const state=worldState();for(const e of values)state.events[e.id]=e;
  const draft=worldDraft(true,'opening');return {state,draft};
}
function resultFor(state:ReturnType<typeof worldState>,draft:ReturnType<typeof worldDraft>,commands:DomainCommand[],timeline:string[]=[]) {
  return parseWorld(JSON.stringify({...worldResult(),eventCommands:commands,timelineCandidates:timeline}),state,draft);
}
function finish(e:WorldEvent, at=actionTime, failure=false):Extract<DomainCommand,{type:'SaveEvent'}> {
  const result=failure?'关键材料损坏，清点以失败结束。':'同事完成清点并封存清单。';
  return {type:'SaveEvent',commandId:`finish-${e.id}`,event:{...e,status:'resolved',resolvedAt:at,resolutionText:result,outcome:failure?'failure':'success'},
    evidence:proof({at,sources:[`event:${e.id}`,'npc:npc-a'],fact:result,decision:{targetId:e.id,status:'resolved',reason:failure?'材料损坏无法恢复':'正常工作完成',result,conditionsSatisfied:!failure,continues:false,failure,resultKnowledge:{facts:[result],reported:[],suspected:[]}}})};
}
function clean(id:string,status:'resolved'|'cancelled'='resolved'):Extract<DomainCommand,{type:'DeleteEvent'}> {
  return {type:'DeleteEvent',commandId:`clean-${id}`,eventId:id,expectedStatus:status,reason:'已经结束且没有继续追踪必要',
    evidence:proof({at:'2026-10-18T08:06:00+08:00',sources:[`event:${id}`],fact:'事项已结束，不再保留完整排程。',decision:{targetId:id,status:'retired',reason:'事毕清理',result:'只保留必要来源引用',conditionsSatisfied:true,continues:false}})};
}
describe('真实World验证与同一正式基线的事件处理',()=>{
  it('新事件必须有完整规划，预计时间必填且参与者不为空；普通任务仍可用完成条件',()=>{
    const a=prepared([]),future={...ongoing(),status:'scheduled' as const,startAt:projectedTime,estimatedEndAt:'2026-10-19T08:00:00+08:00'};
    const c:DomainCommand={type:'SaveEvent',commandId:'create-event',event:future,evidence:proof({kind:'planned',fact:'计划清点诊室。'})};
    expect(resultFor(a.state,a.draft,[c]).eventCommands).toHaveLength(1);
    const {estimatedEndAt:_time,...missing}=future;void _time;const invalid={...missing,completionCondition:'清点完成'};
    expect(()=>resultFor(a.state,a.draft,[{...c,event:invalid}])).toThrow();
    expect(()=>commitCommands(a.state,'direct',0,[{...c,event:invalid}])).toThrow();
    expect(()=>resultFor(a.state,a.draft,[{...c,event:{...future,actorRefs:[]}}])).toThrow();
    const job=task();delete job.dueAt;job.completionCondition='主角到场确认';
    expect(commitCommands(a.state,'task-condition',0,[{type:'SaveTask',commandId:'job',task:job,evidence:'现场约定'}]).tasks[job.id].completionCondition).toBe(job.completionCondition);
  });
  it('未到期保持排程，不自动成功；到期队列包含积压且不擅自结案',()=>{
    const a=prepared([{...ongoing(),estimatedEndAt:'2026-10-20T08:00:00+08:00'}]);
    expect(worldEventSchedule(a.state,projectTurn(a.state,a.draft)).due).toEqual([]);
    expect(resultFor(a.state,a.draft,[]).eventCommands).toEqual([]);
    const b=prepared([{...ongoing(),estimatedEndAt:'2026-10-18T07:59:00+08:00',startAt:'2026-10-18T07:00:00+08:00'}]);
    expect(worldEventSchedule(b.state,projectTurn(b.state,b.draft)).due[0]).toMatchObject({eventId:'investigation',overdue:true});
    expect(()=>resultFor(b.state,b.draft,[])).toThrow();
  });
  it('无外力时AI依据背景正常推演结束，并可清理普通事件不写历史',()=>{
    const a=prepared(),before=structuredClone(a.state),end=finish(a.state.events.investigation);
    const result=resultFor(a.state,a.draft,[clean('investigation'),end]); // 验证与执行均允许来源依赖先行。
    const after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(a.state).toEqual(before);expect(after.events.investigation).toBeUndefined();
    expect(after.retiredEvents.investigation).toMatchObject({id:'investigation',status:'resolved'});
    expect(after.retiredEvents.investigation.detail).toBeUndefined();expect(after.timeline).toEqual([]);
    expect(()=>commitCommands(after,'reuse-id',after.revision,[{...end,event:{...ongoing(),status:'active'}}])).toThrow();
  });
  it.each(['active','blocked'] as const)('外力/阻碍使事件%s并合理延期，不能沿用过期处理时间',status=>{
    const a=prepared(),old=a.state.events.investigation;
    if(status==='blocked')old.blockers=['缺少清点材料'];
    const e={...old,status,estimatedEndAt:'2026-10-19T08:00:00+08:00'};
    const cmd:DomainCommand={type:'SaveEvent',commandId:'delay',event:e,evidence:proof({sources:[`event:${e.id}`,'npc:npc-a'],fact:'材料暂时不能取得，排程调整。',decision:status==='blocked'?{targetId:e.id,status:'blocked',reason:'材料不足',result:'等待下一批材料',conditionsSatisfied:false,continues:true}:undefined})};
    const result=resultFor(a.state,a.draft,[cmd]);expect(projectTurn(a.state,a.draft,result.eventCommands).events[e.id].status).toBe(status);
    expect(()=>resultFor(a.state,a.draft,[{...cmd,event:{...e,estimatedEndAt:actionTime}}])).toThrow();
  });
  it('失败结束允许阻碍未满足，但不能借此宣称成功',()=>{
    const a=prepared();a.state.events.investigation.blockers=['未取得材料'];
    expect(resultFor(a.state,a.draft,[finish(a.state.events.investigation,actionTime,true)]).eventCommands[0]).toMatchObject({event:{outcome:'failure',status:'resolved'}});
    expect(()=>resultFor(a.state,a.draft,[finish(a.state.events.investigation)])).toThrow();
  });
  it('取消未来安排仍可提前成立，不强迫开始时间或成功条件到达',()=>{
    const e={...ongoing(),startAt:'2026-10-20T08:00:00+08:00',estimatedEndAt:'2026-10-20T10:00:00+08:00',status:'scheduled' as const,blockers:['尚未准备好']};
    const a=prepared([e]);
    const c:DomainCommand={type:'SaveEvent',commandId:'cancel',event:{...e,status:'cancelled'},evidence:proof({sources:[`event:${e.id}`,'npc:npc-a'],decision:{targetId:e.id,status:'cancelled',reason:'安排撤销',result:'无需再执行',conditionsSatisfied:false,continues:false}})};
    expect(resultFor(a.state,a.draft,[c,clean(e.id,'cancelled')]).eventCommands).toHaveLength(2);
  });
  it('普通事件可自然承接，原事件清理后前序及任务双向引用仍有效',()=>{
    const a=prepared(),old=a.state.events.investigation;
    const next={...ongoing('followup'),title:'核对新发现的设备',startAt:'2026-10-18T08:06:00+08:00',estimatedEndAt:'2026-10-19T08:00:00+08:00',predecessorEventIds:[old.id],status:'active' as const};
    const c:DomainCommand={type:'SaveEvent',commandId:'followup',event:next,evidence:proof({at:next.startAt,sources:[`event:${old.id}`,'npc:npc-a'],fact:'清点发现异常编号，需要核对设备。'})};
    const result=resultFor(a.state,a.draft,[c,clean(old.id),finish(old)]),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events.followup.predecessorEventIds).toEqual([old.id]);expect(after.retiredEvents[old.id].detail?.resultKnowledge?.facts).toHaveLength(1);
    expect(after.retiredEvents[old.id].detail).not.toHaveProperty('backgroundText');expect(GameStateSchema.safeParse(after).success).toBe(true);
    expect(a.state.events.followup).toBeUndefined();
  });
  it('清理保护任务关联、条件来源及历史，不产生悬空引用',()=>{
    const a=prepared(),e=a.state.events.investigation,job={...task(),linkedEventId:e.id};e.linkedTaskIds=[job.id];a.state.tasks[job.id]=job;
    const result=resultFor(a.state,a.draft,[finish(e),clean(e.id)]),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.tasks[job.id].linkedEventId).toBe(e.id);expect(after.retiredEvents[e.id].linkedTaskIds).toEqual([job.id]);
    expect(GameStateSchema.safeParse(after).success).toBe(true);
  });
  it('隐藏重大结案可以清理但不暴露，不能仅用event来源给其他NPC知识',()=>{
    const a=prepared([{...ongoing(),impact:'major'}]),e=a.state.events.investigation;
    const result=resultFor(a.state,a.draft,[finish(e),clean(e.id)]),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.retiredEvents[e.id].detail?.visibility).toBe('hidden');expect(playerView(after).timeline).toEqual([]);
    expect(worldSources(after,a.draft).find(s=>s.id===`event:${e.id}`)).toMatchObject({worldEventOnly:true});
    expect(JSON.stringify(playerView(after))).not.toContain('清点并封存');
    after.npc['npc-b']={...npc('npc-b'),onScene:false};
    const next=worldDraft(true,'regular');next.baseSaveRevision=after.revision;next.turnId='next-hidden';
    expect(()=>parseWorld(JSON.stringify(worldResult([{type:'UpdateNpc',commandId:'leaked-secret',npcId:'npc-b',expectedRevision:after.revision,changes:{healthText:'因得知秘密而警惕'},evidence:proof({kind:'established',at:projectedTime,sources:[`event:${e.id}`,'npc:npc-b'],fact:'同事完成清点并封存清单。'})}])),after,next)).toThrow();
  });
  it('重大事件只有独立公开来源支持的内容可归档，秘密详情不跟随公开',()=>{
    const a=prepared([{...ongoing(),impact:'major'}]),e=a.state.events.investigation;
    a.draft.story!.narrative='公开通告：诊室检查结束。清点工作已经结束。';
    const archive:DomainCommand={type:'ArchiveEvent',commandId:'archive',eventId:e.id,title:'诊室检查结束',summary:'清点工作已经结束',evidence:proof({kind:'established',at:'2026-10-18T08:06:00+08:00',sources:[`event:${e.id}`,'story:current'],fact:'公开通告：诊室检查结束。清点工作已经结束。'})};
    const result=resultFor(a.state,a.draft,[finish(e),archive]),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events[e.id]).toBeUndefined();expect(playerView(after).timeline[0]).toMatchObject({title:'诊室检查结束',outcome:'清点工作已经结束'});
    expect(worldSources(after,a.draft).find(s=>s.id===`event:${e.id}`)?.worldEventOnly).toBe(true);
    expect(()=>resultFor(a.state,a.draft,[finish(e),{...archive,title:'未经公开的内部秘密'}])).toThrow();
  });
  it.each([1,2,3,4])('V%s旧档缺预计时间，迁移不伪造日期、事实或正式版本',version=>{
    const original=prepared().state;const e=original.events.investigation;delete e.estimatedEndAt;delete e.backgroundText;delete e.goalText;
    const raw:Record<string,unknown>={...original,schemaVersion:version}; delete raw.retiredEvents;
    if(version<=3)delete raw.contactReviewNpcIds;
    if(version<=2){delete raw.contactNpcIds;delete raw.retiredNpcs;}
    if(version===1){delete raw.weatherText;delete raw.environmentText;}
    const migrated=migrateSave(raw);expect(migrated.schemaVersion).toBe(5);expect(migrated.worldClock).toBe(original.worldClock);expect(migrated.revision).toBe(original.revision);
    expect(migrated.events[e.id]).toEqual(e);expect(migrated.retiredEvents).toEqual({});
  });
});

describe('跨窗口、承接与引用的阻断回归',()=>{
  it('长时间跳跃中多个到期节点按时间输入，批内依赖先行，已终结/未来节点不重复调度',()=>{
    const a=prepared([{...ongoing('late'),estimatedEndAt:'2026-10-18T08:08:00+08:00'},ongoing('early'),{...ongoing('tomorrow'),estimatedEndAt:'2026-10-20T08:00:00+08:00'}]);
    expect(worldEventSchedule(a.state,projectTurn(a.state,a.draft)).due.map(e=>e.eventId)).toEqual(['early','late']);
    const later=finish(a.state.events.late,'2026-10-18T08:08:00+08:00');later.event.prerequisites=['event:early'];
    const early=finish(a.state.events.early);
    const result=resultFor(a.state,a.draft,[later,early,clean('early'),{...clean('late'),evidence:proof({at:'2026-10-18T08:09:00+08:00',sources:['event:late'],fact:'清点已经结束，清理记录。'})}]);
    const after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events.tomorrow.status).toBe('active');expect(worldEventSchedule(after,after).due).toEqual([]);
  });
  it('未结束对象不能清理，未来动作不能提前完成；循环/不存在的承接不能落库',()=>{
    const a=prepared(),before=structuredClone(a.state);
    expect(()=>resultFor(a.state,a.draft,[clean('investigation')])).toThrow();
    const future={...ongoing(),startAt:'2026-10-20T08:00:00+08:00',estimatedEndAt:'2026-10-20T09:00:00+08:00',status:'scheduled' as const};
    const b=prepared([future]);expect(()=>resultFor(b.state,b.draft,[finish(future)])).toThrow();
    expect(()=>commitCommands(a.state,'cycle',0,[{type:'SaveEvent',commandId:'missing-link',event:{...ongoing('next'),predecessorEventIds:['missing']},evidence:'承接'}])).toThrow();
    const ended={...ongoing(),status:'resolved' as const,resolvedAt:actionTime,resolutionText:'结束',predecessorEventIds:['investigation']};
    expect(GameStateSchema.safeParse({...a.state,worldClock:projectedTime,events:{investigation:ended}}).success).toBe(false);
    expect(a.state).toEqual(before);
  });
  it('清理重大隐藏事件后，后续回合有独立公开依据才可归档；不公开内部成果',()=>{
    const a=prepared([{...ongoing(),impact:'major'}]),old=a.state.events.investigation;
    const ended=resultFor(a.state,a.draft,[finish(old),clean(old.id)]),after=projectTurn(a.state,a.draft,ended.eventCommands);
    const next=worldDraft(true,'regular');next.baseSaveRevision=after.revision;next.turnId='later-turn';
    const publicText='正式通告：检查结束。诊室重新开放。';next.story!.narrative=publicText;
    const archive:DomainCommand={type:'ArchiveEvent',commandId:'later-archive',eventId:old.id,title:'检查结束',summary:'诊室重新开放',evidence:proof({kind:'established',at:projectedTime,sources:[`event:${old.id}`,'story:current'],fact:publicText})};
    const result=resultFor(after,next,[archive]),published=projectTurn(after,next,result.eventCommands);
    expect(playerView(published).timeline).toHaveLength(1);expect(JSON.stringify(playerView(published).timeline)).not.toContain('封存清单');
    expect(published.retiredEvents[old.id].detail?.visibility).toBe('hidden');
    expect(GameStateSchema.safeParse(published).success).toBe(true);
    next.story!.narrative='平静的夜晚。';expect(()=>resultFor(after,next,[archive])).toThrow();
  });
  it('NPC来源引用需要保留的普通事件成果不会消失；不能借清理把私有转述洗成事实',()=>{
    const a=prepared(),old=a.state.events.investigation;
    a.state.npc['npc-a'].knownInformation=[{text:'听说清点有异常',source:'event-result:investigation',learnedAt:a.state.worldClock}];
    const result=resultFor(a.state,a.draft,[finish(old),clean(old.id)]),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.retiredEvents[old.id].detail?.resultKnowledge?.facts).toEqual(['同事完成清点并封存清单。']);
    expect(worldSources(after,a.draft).find(e=>e.id==='event-result:investigation')).toMatchObject({knowledge:'statement',worldEventOnly:true});
  });
});

import { timePreflight } from '../domain/timePreflight';
describe('长跨度行动中的公开时间提示',()=>{
  it('已开始的公开直接来电可在预计节点提示条件中断，隐藏节点不泄露、不自动完成',()=>{
    const state=worldState();state.events.call={...event('call'),title:'主角收到预约来电通知',startAt:'2026-10-18T07:00:00+08:00',estimatedEndAt:actionTime,visibility:'known'};
    const before=structuredClone(state),result=timePreflight(state,'等待两小时');
    expect(result.candidates).toEqual([expect.objectContaining({id:'call',at:actionTime,conditional:true})]);expect(state).toEqual(before);
    state.events.call.visibility='hidden';expect(timePreflight(state,'等待两小时').candidates).toEqual([]);
  });
  it('相同实际中断节点不在重载后重复触发，阻碍/结案记录不作为必然中断',()=>{
    const state=worldState();state.events.call={...event('call'),title:'主角收到预约来电通知',startAt:'2026-10-18T07:00:00+08:00',estimatedEndAt:actionTime,visibility:'known'};
    state.journal=[{turnId:'past-interrupt',revision:0,relatedActorRefs:[],story:{turnKind:'opening',narrative:'电话响起',summary:'电话响起',variableGuide:[{group:'time',subjectHint:'time:interrupt:call',observedFact:actionTime}]}}];state.turnNumber=1;
    expect(timePreflight(state,'等待两小时').candidates).toEqual([]);
    state.journal=[];state.turnNumber=0;state.events.call.blockers=['没有通信信号'];expect(timePreflight(state,'等待两小时').candidates).toEqual([]);
    state.events.call.blockers=[];state.events.call.status='cancelled';expect(timePreflight(state,'等待两小时').candidates).toEqual([]);
  });
});

import { settleTurn } from '../domain/turnCommit';
import { TurnDraftSchema } from '../domain/drafts';
it('已知重大终态的时间线在清理后仍可正式提交；取消需要真实终止时间',()=>{
  for(const status of ['resolved','cancelled'] as const){
    const ended={...ongoing(),status,visibility:'known' as const,impact:'major' as const,startAt:'2026-10-18T07:00:00+08:00',resolvedAt:'2026-10-18T08:00:00+08:00',resolutionText:'重大事项已经结束。'};
    const a=prepared([ended]);const result=resultFor(a.state,a.draft,[clean(ended.id,status)],[ended.id]);
    const complete=TurnDraftSchema.parse({...a.draft,world:{storyRevision:1,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated',result},stageStatus:{...a.draft.stageStatus,world:'ready'}});
    const state=settleTurn(a.state,complete,a.state.updatedAt);expect(state.events[ended.id]).toBeUndefined();expect(state.timeline).toHaveLength(1);expect(playerView(state).timeline).toHaveLength(1);
    if(status==='cancelled'){delete a.state.events[ended.id].resolvedAt;expect(()=>resultFor(a.state,a.draft,[],[ended.id])).toThrow();}
  }
});

it('旧缺排程事件可真实终结并安全清理，不为清理补造历史预计日期',()=>{
  const a=prepared(),old=a.state.events.investigation;delete old.estimatedEndAt;delete old.backgroundText;delete old.goalText;
  const result=resultFor(a.state,a.draft,[finish(old),clean(old.id)]),after=projectTurn(a.state,a.draft,result.eventCommands);
  expect(after.events[old.id]).toBeUndefined();expect(after.retiredEvents[old.id]).toBeDefined();
  const created={...finish(old),event:{...finish(old).event,id:'brand-new'}};
  expect(()=>resultFor(a.state,a.draft,[created])).toThrow();
});

it('纯过去视角不消费当前世界积压事件，也不被到期处理强制改写当前世界',()=>{
  const a=prepared([{...ongoing(),startAt:'2026-10-18T07:00:00+08:00',estimatedEndAt:'2026-10-18T07:30:00+08:00'}]);
  a.draft.userInput='切换到同事的视角，描写他昨天晚上的经历。';
  a.draft.story!.variableGuide=[{group:'time',subjectHint:'time:retrospective',observedFact:JSON.stringify({npcId:'npc-a',perspectiveRequest:'切换到同事的视角',pastRequest:'描写他昨天晚上的经历',temporalScope:'past_only',currentPlotAdvances:false})}];
  a.draft.variables!.result.commands=[];const before=structuredClone(a.state);
  expect(()=>parseWorld(JSON.stringify({...worldResult(),visibleHooks:[],unresolved:[]}),a.state,a.draft)).not.toThrow();
  expect(a.state).toEqual(before);expect(worldEventSchedule(a.state,a.state).due).toHaveLength(1);
  const context=contextFor({stage:'world',mode:a.draft.turnKind,state:a.state,draft:a.draft,settings:defaultSettings(),userInput:''});
  expect(context.EVENT_SCHEDULE).toMatchObject({readOnly:true});
});

it('开局同伴的受保护事件不被排入强制场外处置，保持原World权限',()=>{
  const a=prepared();a.state.initialCompanionId='npc-a';
  expect(worldEventSchedule(a.state,projectTurn(a.state,a.draft)).due).toEqual([]);
  expect(worldEventSchedule(a.state,projectTurn(a.state,a.draft)).scenePending).toContain('investigation');
  expect(()=>resultFor(a.state,a.draft,[])).not.toThrow();
});

it('未来安排可提前取消并记录真实终止时刻；公开重大取消可归档，不伪造未来时间',()=>{
  const e={...ongoing(),impact:'major' as const,status:'scheduled' as const,startAt:'2026-10-20T08:00:00+08:00',estimatedEndAt:'2026-10-20T10:00:00+08:00'},a=prepared([e]);
  const publicText='公开通知：排程撤销。无需再赴约。';a.draft.story!.narrative=publicText;
  const cancelled:DomainCommand={type:'SaveEvent',commandId:'future-cancel-at',event:{...e,status:'cancelled',resolvedAt:actionTime,resolutionText:'未来排程已撤销。'},
    evidence:proof({sources:[`event:${e.id}`,'npc:npc-a'],fact:'排程已撤销。',decision:{targetId:e.id,status:'cancelled',reason:'安排不再必要',result:'未来排程已撤销。',conditionsSatisfied:false,continues:false}})};
  const archive:DomainCommand={type:'ArchiveEvent',commandId:'future-cancel-archive',eventId:e.id,title:'排程撤销',summary:'无需再赴约',
    evidence:proof({kind:'established',at:'2026-10-18T08:06:00+08:00',sources:[`event:${e.id}`,'story:current'],fact:publicText})};
  const result=resultFor(a.state,a.draft,[cancelled,archive]),after=projectTurn(a.state,a.draft,result.eventCommands);
  expect(after.timeline[0].occurredAt).toBe(actionTime);expect(after.retiredEvents[e.id].detail?.startAt).toBe(e.startAt);
  expect(GameStateSchema.safeParse(after).success).toBe(true);
});
