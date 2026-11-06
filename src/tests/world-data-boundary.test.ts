import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DomainCommand } from '../domain/commands';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { completeDraft, submission } from './fixtures/turn';
import { event, task, npc } from './fixtures/game';
import { worldState, worldDraft, worldResult, actionTime, projectedTime, npcUpdate } from './fixtures/world';

const repos: SaveRepository[] = [];
afterEach(() => repos.splice(0).forEach(repo => repo.close()));
const actor = { kind: 'npc' as const, id: 'npc-a' };
const later = '2026-10-18T09:00:00+08:00';
const context = () => ({ state: worldState(), draft: worldDraft(true, 'opening') });
function incident(id = 'event-natural'): Extract<DomainCommand,{type:'SaveEvent'}> {
  return { type:'SaveEvent', commandId:`save-${id}`, evidence:'根据本轮剧情与世界状态安排。', event:{...event(id),
    status:'active', actorRefs:[actor], estimatedEndAt:later, title:'整理工作正在推进', sourceTurnIds:['turn-a']} };
}
function parse(a: ReturnType<typeof context>, commands: DomainCommand[]) {
  return parseWorld(JSON.stringify({...worldResult(),eventCommands:commands}),a.state,a.draft);
}

describe('World只校验数据，不审批文字', () => {
  it.each(['正在整理迎检资料。','学校将进行检查。','据说已经整理好了。','并没有开展调查。','确保计划落实到位。'])('自然语言 %s 不决定合法active状态能否保存', evidence => {
    const a=context(),command=incident();command.evidence=evidence;
    expect(parse(a,[command]).eventCommands[0]).toMatchObject({event:{status:'active'},evidence});
  });
  it.each(['【旁白】吴杰涛停在柜台前，伸手挡住欠条。','【吴杰涛】我会先看一下文件。','【旁白】\n两人留在柜台。'])('现场事件可自然概括，不使用文字锚点：%s', narrative => {
    const a=context();a.draft.story!.narrative=narrative;
    const command=incident();command.event.actorRefs=[{kind:'protagonist',id:a.state.protagonist.id},{kind:'npc',id:'scene'}];
    command.event.title='柜台上的文件暂未处理';command.event.backgroundText='当事人正在了解情况';command.event.goalText='等待下一步回应';
    expect(parse(a,[command]).eventCommands[0]).toMatchObject({event:{title:command.event.title}});
  });
  it('相似姓名由稳定ID落账，不解析姓名前缀',()=>{
    const a=context();a.state.npc['npc-a'].name='吴杰涛';a.state.npc['npc-b']={...npc('npc-b'),name:'吴杰',onScene:false};
    const result=parseWorld(JSON.stringify(worldResult([{...npcUpdate(),evidence:'吴杰涛休息片刻。'}])),a.state,a.draft);
    const after=projectTurn(a.state,a.draft,result.worldCommands);
    expect(after.npc['npc-a'].healthText).toBe('稍感疲倦');expect(after.npc['npc-b']).toEqual(a.state.npc['npc-b']);
  });
  it('场外任务直接使用结构化成果；无需decision许可或独立来源',()=>{
    const a=context();const command:DomainCommand={type:'SaveTask',commandId:'task-finish',evidence:'整理工作完成，结论是工作人员的估计。',
      task:{...task(),actorRef:actor,status:'completed',dueAt:later,resolution:{at:actionTime,outcome:'success',result:'清单已整理，另有尚待确认的传闻。',reason:'依实际进展判断',sourceTurnId:a.draft.turnId}}};
    expect(parseWorld(JSON.stringify({...worldResult(),taskCommands:[command]}),a.state,a.draft).taskCommands).toEqual([command]);
  });
  it('任务交接允许改写成果文字，仍保留真实前序ID和时间',()=>{
    const a=context();a.state.tasks.prior={...task('prior'),actorRef:actor,status:'completed',resolution:{at:a.state.worldClock,outcome:'success',result:'一共有十个箱子，已经全部逐项清点。',reason:'完成清点',sourceTurnId:'old-turn'}};
    const next={...task('next'),actorRef:actor,status:'planned' as const,startAt:projectedTime,dueAt:later,
      handoff:{fromTaskId:'prior',at:actionTime,channel:'内部交接',content:'箱数为10，清点工作结束。',necessity:'复查清单',knowledgeKind:'reported' as const}};
    expect(parseWorld(JSON.stringify({...worldResult(),taskCommands:[{type:'SaveTask',commandId:'next',task:next,evidence:'自由概括'}]}),a.state,a.draft)).toBeDefined();
  });
  it.each(['success','failure','changed'] as const)('事件以%s结束，不做叙述性质审批',outcome=>{
    const a=context(),command=incident();command.event={...command.event,status:'resolved',resolvedAt:actionTime,resolutionText:'模型给出的本次结果，含调查对象的否认。',outcome};
    expect(parse(a,[command]).eventCommands[0]).toMatchObject({event:{status:'resolved',outcome}});
  });
  it('未来安排可以取消，不要求已经开始或使用固定取消词',()=>{
    const a=context(),command=incident();a.state.events[command.event.id]={...command.event,status:'scheduled',startAt:later,estimatedEndAt:'2026-10-18T10:00:00+08:00',sourceTurnIds:[]};
    command.event={...a.state.events[command.event.id],status:'cancelled',sourceTurnIds:[a.draft.turnId]};command.evidence='场地另有用途，保留人手';
    expect(parse(a,[command])).toBeDefined();
  });
});

describe('保留权限、引用、时间和正式事务',()=>{
  it.each(['invalid-id','future-resolution','missing-estimate','active-result'] as const)('%s仍整批失败',fault=>{
    const a=context(),before=structuredClone(a.state),command=incident();
    if(fault==='invalid-id')command.event.actorRefs=[{kind:'npc',id:'not-existing'}];
    if(fault==='future-resolution')command.event={...command.event,status:'resolved',resolvedAt:later,resolutionText:'结果'};
    if(fault==='missing-estimate')delete command.event.estimatedEndAt;
    if(fault==='active-result')command.event.resolutionText='预填结果';
    expect(()=>parse(a,[command])).toThrow();expect(a.state).toEqual(before);
  });
  it.each(['scene','protagonist','clock'] as const)('%s不能通过World获得直接操作权限',kind=>{
    const a=context();const command=kind==='scene'?{...npcUpdate(),npcId:'scene',evidence:'自由说明'}
      :kind==='clock'?{type:'SetWorldClock',commandId:'clock-extra',worldClock:later,evidence:'自由说明'}
        :{type:'UpdateProtagonist',commandId:'move-player',expectedRevision:0,changes:{locationId:'clinic'},evidence:'自由说明'};
    expect(()=>parseWorld(JSON.stringify(worldResult([command as DomainCommand])),a.state,a.draft)).toThrow();
  });
  it('NPC私人记忆只写指定人物，不传播给其他NPC或主角正文',()=>{
    const a=context();a.state.npc['npc-b']={...npc('npc-b'),onScene:false};
    const memory:DomainCommand={type:'RecordNpcMemory',commandId:'remember',npcId:'npc-a',expectedRevision:0,layer:'personal',knowledgeKind:'suspected',addToKnownInformation:true,evidence:'自己的疑问，无需来源令牌',
      memory:{id:'private-a',text:'[推测]仓库里也许有另一份清单',knowledgeSource:'自己回想',visibility:'npc_private',createdAtGameTime:actionTime,sourceTurnIds:[a.draft.turnId],affectedEntityRefs:[actor]}};
    const result=parseWorld(JSON.stringify(worldResult([memory])),a.state,a.draft),after=projectTurn(a.state,a.draft,result.worldCommands);
    expect(after.npc['npc-b']).toEqual(a.state.npc['npc-b']);
    const story=contextFor({stage:'story',mode:'regular',state:after,settings:defaultSettings(),userInput:'继续'});
    expect(JSON.stringify(story)).not.toContain('另一份清单');expect(after.npc['npc-a'].memories).toHaveLength(1);
  });
  it('不能用后来才结束的前置条件倒填较早的实际结案',()=>{
    const a=context();a.state.events.prior={...event('prior'),status:'active',estimatedEndAt:later,actorRefs:[actor],sourceTurnIds:[]};
    const prior=incident('prior');prior.event={...a.state.events.prior,status:'resolved',resolvedAt:projectedTime,resolutionText:'前置结束',sourceTurnIds:[a.draft.turnId]};
    const dependent=incident('dependent');dependent.event={...dependent.event,status:'resolved',resolvedAt:actionTime,resolutionText:'后继结束',prerequisites:['event:prior']};
    expect(()=>parse(a,[dependent,prior])).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'completion_conditions'})}));
    dependent.event.resolvedAt=projectedTime;expect(parse(a,[dependent,prior]).eventCommands).toHaveLength(2);
  });
  it('validated标记不能绕过变量Schema和引用重验',()=>{
    const a=context();a.draft.variables!.result.commands[1].commandId='constructor';
    expect(()=>parse(a,[])).toThrow();
  });
  it('候选、Commit重验、重载和回执重放保持原子性',async()=>{
    const a=context(),before=structuredClone(a.state),repo=await SaveRepository.open('world-no-semantic',new IDBFactory());repos.push(repo);await repo.create(a.state);
    const initial=await completeDraft(repo);const command=incident();command.event.sourceTurnIds=[initial.turnId];
    const result=parseWorld(JSON.stringify({...worldResult(),eventCommands:[command]}),a.state,initial);
    const draft=await repo.saveDraft({...initial,draftRevision:initial.draftRevision+1,world:{...initial.world!,candidateRevision:2,result}},initial.draftRevision);
    expect(await repo.load('save-a')).toEqual(before);
    const committed=await repo.commitTurn({...submission(draft),nextAction:''});
    expect(committed.state.events['event-natural'].title).toBe('整理工作正在推进');
    expect((await repo.commitTurn({...submission(draft),nextAction:''})).replayed).toBe(true);
    expect((await repo.load('save-a')).events).toEqual(committed.state.events);
  });
});
