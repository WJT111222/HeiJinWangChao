import { stagedFixture } from './fixtures/stageScope';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { TurnDraftSchema, rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { worldEventSchedule } from '../domain/events/schedule';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { SaveRepository } from '../services/storage/saveRepository';
import { revalidateWorld } from '../services/validation/aiOutputs';
import { parseVariableBatch, parsePartialWorld } from '../services/validation/partialOutputs';
import { structuredRefs } from '../services/validation/updateIsolation';
import { defaultSettings } from '../ui/settings/model';
import { stageCommand } from './fixtures/eventStages';
import { handoffDeadline, issue194 } from './fixtures/issue194';
import { event, task } from './fixtures/game';
import { submission } from './fixtures/turn';
import { worldResult } from './fixtures/world';
import {
  assign, correctPlace, isolationClock, isolationNpcIds, locationIsolationCommands, locationsForIsolation,
  mutualOrganization, relationTo, wrapUpdates, wrongPlace,
} from './fixtures/locationIsolation';

const parsePartialVariables = (text: string, state: Parameters<typeof parseVariableBatch>[1], draft: Parameters<typeof parseVariableBatch>[2]) =>
  parseVariableBatch(text, state, draft, 'combined');

const wrap = (commands: string) => `<thinking>合成说明不执行。</thinking><说明>准备登记变化。</说明><命令>\n${commands}\n</命令>`;
const item = { name:'合成便条', category:'document', quantity:1, conditionText:'完整' };
const emotion = 'set protagonist.emotionText = "平静"';
const makeItem = `set items[note] = ${JSON.stringify(item, null, 2)}`;
const buy = `set items[purchase].purchase = ${JSON.stringify({account:'cash',price:50,item})}`;

function withVariables(draft: TurnDraft, result: NonNullable<TurnDraft['variables']>['result']) {
  return stagedFixture({...draft,useEntityStage:true,entities:undefined,variables:{...draft.variables,result},world:undefined,
    stageStatus:{...draft.stageStatus,variables:'ready',world:'pending'}});
}
function saveWorld(draft: TurnDraft, result: NonNullable<TurnDraft['world']>['result']) {
  return TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1,stageStatus:{...draft.stageStatus,world:'ready'},
    world:{storyRevision:draft.storyRevision,candidateRevision:1,requestRevision:draft.stageRequestRevisions.world,
      basedOnEntityRevision:draft.entities?.candidateRevision,basedOnVariableRevision:draft.variables!.candidateRevision,validation:'validated',result}});
}

describe('隔离结构、依赖和事务', () => {
  it('包含多行对象的无归属物品和对它的操作一起跳过，人物与正常物品保留', async () => {
    const {state,draft}=issue194();
    const transfer='set items[note].transfer = {"from":{"kind":"protagonist","id":"hero"},"to":{"kind":"organization","id":"org-stage-a"}}';
    const valid=`set items[valid] = ${JSON.stringify({...item,ownerRef:{kind:'protagonist',id:'hero'}})}`;
    const result=await parsePartialVariables(wrap([makeItem, emotion, transfer, valid].join('\n')),state,draft);
    expect(result.settlement?.skipped).toMatchObject([
      {commandIndex:0,category:'item',reason:'schema',field:'ownerRef'},
      {commandIndex:2,category:'item',reason:'dependency'},
    ]);
    const projected=projectTurn(state,withVariables(draft,result));
    expect(projected.protagonist.emotionText).toBe('平静');
    expect(projected.items.note).toBeUndefined();
    expect(projected.items.valid.ownerRef).toEqual({kind:'protagonist',id:'hero'});
  });

  it.each([buy, `add economy.cash = -50\n${makeItem}`, 'push economy.transfers = {"from":"cash","to":"onlineBalance"}'])(
    '坏购买或转账不会扣款、入库或单边生效', async command => {
      const {state,draft}=issue194();
      const result=await parsePartialVariables(wrap([command,emotion].join('\n')),state,draft);
      const projected=projectTurn(state,withVariables(draft,result));
      expect(projected.economy).toEqual(state.economy);
      expect(projected.items).toEqual(state.items);
      expect(projected.protagonist.emotionText).toBe('平静');
      expect(result.settlement?.skipped).not.toHaveLength(0);
    },
  );

  it('坏数组写入与依赖现有索引的删除一起跳过，不误删正式技能', async () => {
    const {state,draft}=issue194();
    state.protagonist.skills=['保留的技能'];
    const result=await parsePartialVariables(wrap([
      'set protagonist.skills = [7]','delete protagonist.skills[0]',emotion,
    ].join('\n')),state,draft);
    const projected=projectTurn(state,withVariables(draft,result));
    expect(projected.protagonist.skills).toEqual(['保留的技能']);
    expect(projected.protagonist.emotionText).toBe('平静');
    expect(result.settlement?.skipped).toMatchObject([{commandIndex:0},{commandIndex:1,reason:'dependency'}]);
  });

  it('World 逐条拒绝坏创建、下游记忆及坏字段，保留组织和独立任务并追踪原始位置', async () => {
    const {state,draft}=issue194();
    const raw={...worldResult(),worldCommands:[
      {type:'CreateNpc',commandId:'bad',npc:{id:'secret-test-npc'}},
      {type:'RecordNpcMemory',commandId:'dependent',npcId:'secret-test-npc'},
      {type:'UpdateOrganization',commandId:'good-org',expectedRevision:state.revision,organizationId:'org-stage-a',
        changes:{operatingStatus:'接受的组织状态'},evidence:'合成验证'},
      {type:'UpdateOrganization',commandId:'bad-revision',expectedRevision:-1,organizationId:'org-stage-a',
        changes:{operatingStatus:'不应用的状态'},evidence:'合成验证'},
    ],taskCommands:[{type:'SaveTask',commandId:'good-task',evidence:'合成任务',task:{...task('accepted-task'),
      actorRef:{kind:'organization',id:'org-stage-a'},status:'planned',startAt:handoffDeadline,dueAt:'2026-05-17T15:00:00+08:00'}}]};
    const result=await parsePartialWorld(wrap(JSON.stringify(raw)),state,draft);
    expect([...result.worldCommands,...result.taskCommands].map(c=>c.commandId)).toEqual(['good-org','good-task']);
    expect(result.settlement?.skipped).toMatchObject([{commandIndex:0},{commandIndex:1},{commandIndex:3,field:'expectedRevision'}]);
    expect(JSON.stringify(result.settlement)).not.toContain('secret-test-npc');
  });

  it('完整三段式和旧 JSON 语义相同，说明缺失可提示，多个块或截断禁止执行',async()=>{
    const {state,draft}=issue194();
    const text=JSON.stringify({...worldResult(),visibleHooks:[],unresolved:[]});
    expect(await parsePartialWorld(wrap(text),state,draft)).toEqual(await parsePartialWorld(text,state,draft));
    expect((await parsePartialWorld(`<thinking>未闭合的说明\n<命令>${text}</命令>`,state,draft)).settlement?.formatWarning).toBe(true);
    expect((await parsePartialVariables(`<命令>${emotion}</命令>`,state,draft)).settlement?.formatWarning).toBe(true);
    for(const bad of [`<命令>${text}</命令><命令>${text}</命令>`,wrap(text.slice(0,-1))])
      await expect(parsePartialWorld(bad,state,draft)).rejects.toThrow();
    await expect(parsePartialVariables(wrap('set protagonist.skills = [\n'+emotion),state,draft)).rejects.toThrow();
    await expect(parsePartialWorld(JSON.stringify({...worldResult(),deferredEvents:['invented']}),state,draft)).rejects.toThrow();
  });

  it('没有变化与全部更新被拒绝分别表示',async()=>{
    const {state,draft}=issue194();
    expect((await parsePartialVariables(wrap(''),state,draft)).settlement).toBeUndefined();
    expect((await parsePartialVariables(wrap(makeItem),state,draft)).settlement).toMatchObject({accepted:0,skipped:[{category:'item'}]});
  });

  it('到期承接失败保留原记录，接受集合由 Repository 重验、备份、幂等保存、下一回合和撤回',async()=>{
    const a=issue194();
    const factory=new IDBFactory(), repo=await SaveRepository.open('partial-settlement',factory);
    const {state,draft}=a;
    const variables=await parsePartialVariables(wrap([`set worldClock = "${handoffDeadline}"`,makeItem,emotion].join('\n')),state,draft);
    const input={state,draft:withVariables(draft,variables)};
    try {
      await repo.importBackup(input,(await repo.compareBackup(input)).confirmation);
      const before=await repo.loadGame(state.saveId), selected=before.draft!;
      const prompt=await composePrompt({stage:'world',mode:'regular',state,draft:selected,userInput:'',settings:defaultSettings()});
      expect(prompt.context.VARIABLE_RESULT).toMatchObject({result:{settlement:{skipped:[{commandIndex:1,category:'item'}]}}});
      expect(JSON.stringify(prompt.context.VARIABLE_RESULT)).not.toContain('合成便条');
      const independent={type:'UpdateOrganization',commandId:'org-change',organizationId:'org-stage-a',
        expectedRevision:state.revision,changes:{operatingStatus:'继续核对'},evidence:'合成更新'};
      const world=await parsePartialWorld(wrap(JSON.stringify({...a.response,worldCommands:[independent]})),state,selected);
      expect(world.deferredEvents).toEqual([a.source.id]);
      expect(world.settlement).toMatchObject({accepted:1,skipped:[{commandIndex:1,groupIndex:0,field:'protagonistEntry'}]});
      expect(() => revalidateWorld(state,saveWorld(selected,{...world,deferredEvents:['forged']}))).toThrow();
      const ready=await repo.saveDraft(saveWorld(selected,world),selected.draftRevision);
      const committing=submission(ready,'继续核对');
      const once=await repo.commitTurn(committing);
      expect((await repo.commitTurn(committing)).replayed).toBe(true);
      expect(once.state.events[a.source.id]).toEqual(before.state.events[a.source.id]);
      expect(once.state.items.note).toBeUndefined();
      expect(once.state.organizations['org-stage-a']).toMatchObject({operatingStatus:'继续核对'});
      expect(once.state.protagonist.emotionText).toBe('平静');
      expect((await repo.exportBackup([state.saveId]))[0].state.journal.at(-1)?.settlement).toMatchObject({deferred:1});
      const next=rerollStory(once.draft,{turnKind:'regular',narrative:'继续核对。',summary:'核对。',variableGuide:[]});
      const nextVariables=await parsePartialVariables(wrap(''),once.state,next);
      const based=withVariables({...next,variables:selected.variables},nextVariables);
      const projected=projectTurn(once.state,based);
      expect(worldEventSchedule(once.state,projected).due).toContainEqual(expect.objectContaining({eventId:a.source.id,fixedEndAt:handoffDeadline}));
      const finish={...a.terminal,sourceTurnIds:[...a.terminal.sourceTurnIds.filter(id=>id!==draft.turnId),based.turnId]};
      const successor={...a.successor,sourceTurnIds:[based.turnId]};
      const nextWorld=await parsePartialWorld(wrap(JSON.stringify({...a.response,eventCommands:[stageCommand(finish),stageCommand(successor)]})),once.state,based);
      expect(nextWorld.deferredEvents).toBeUndefined();
      expect(nextWorld.eventCommands).toHaveLength(2);
      const reopened=await SaveRepository.open('partial-settlement',factory);
      try {
        expect(await reopened.load(state.saveId)).toEqual(once.state);
        const undone=await reopened.undoTurn({saveId:state.saveId,expectedRevision:once.state.revision,expectedDraft:once.draft,operationId:'partial-undo'});
        expect(undone.state.journal).toEqual(before.state.journal);
        expect(undone.state.organizations).toEqual(before.state.organizations);
      } finally { reopened.close(); }
    } finally { repo.close(); }
  });
});

describe('地点写入精确隔离', () => {
  const npcMove = assign('npc[npc-a].locationId', 'room-b');
  const heroMove = assign('protagonist.locationId', 'room-b');
  const badItem = assign('items[item-a].locationId', wrongPlace);
  const parseBatch = (commands: readonly string[], fixture = locationsForIsolation()) =>
    parsePartialVariables(wrapUpdates(commands.join('\n')), fixture.state, fixture.draft);
  const locationError = { group:'variables', commandIndex:2, groupIndex:2, category:'item', field:'locationId', reason:'reference' };

  it.each([[npcMove, heroMove], [heroMove, npcMove]])('保留联合合法移动的两种原始顺序：%s', async (first, second) => {
    const fixture = locationsForIsolation();
    const { state, draft } = fixture;
    const control = await parseBatch([first, second], fixture);
    const result = await parseBatch([first, second, badItem], fixture);
    expect(result.settlement).toEqual({ accepted:2, skipped:[locationError] });
    const projected = projectTurn(state,withVariables(draft,result));
    expect(projected).toEqual(projectTurn(state,withVariables(draft,control)));
    expect(projected.protagonist.locationId).toBe('room-b');
    expect(projected.npc['npc-a']).toMatchObject({locationId:'room-b',onScene:true});
    expect(projected.items['item-a']).toEqual(state.items['item-a']);
  });

  it('联合合法的双向新组织引用与无关坏地点共存，地点层级仍拒绝循环', async () => {
    const {state,draft} = locationsForIsolation();
    const create = (id: string, other: string) => {
      const { id: entityId, ...organization } = mutualOrganization(id, other);
      return assign(`organizations[${entityId}]`, organization);
    };
    const result = await parseBatch([create('mutual-a','mutual-b'), create('mutual-b','mutual-a'), badItem]);
    expect(result.settlement).toEqual({accepted:2,skipped:[locationError]});
    const projected = projectTurn(state, withVariables(draft,result));
    expect(projected.organizations['mutual-a']).toEqual(mutualOrganization('mutual-a','mutual-b'));
    expect(projected.organizations['mutual-b']).toEqual(mutualOrganization('mutual-b','mutual-a'));
    const invalid = await parseBatch([
      assign('locations[cycle-a]',{ name:'环甲',parentId:'cycle-b' }),
      assign('locations[cycle-b]',{ name:'环乙',parentId:'cycle-a' }),
      emotion,
    ]);
    expect(invalid.settlement?.skipped.map(u=>u.commandIndex)).toEqual([0,1]);
    expect(projectTurn(state,withVariables(draft,invalid)).locations).toEqual(state.locations);
  });

  it('无法单条归责时联合验证互引新对象与场景一致性，保持原有执行顺序', async () => {
    const fixture = locationsForIsolation(), { state, draft } = fixture;
    const create = (id: string, other: string) => {
      const { id: entityId, ...organization } = mutualOrganization(id, other);
      return assign(`organizations[${entityId}]`, organization);
    };
    const result = await parseBatch([
      npcMove, create('mutual-a','mutual-b'), create('bad-org','not-created'), heroMove, create('mutual-b','mutual-a'),
    ], fixture);
    expect(result.settlement).toMatchObject({accepted:4,skipped:[{commandIndex:2}]});
    const projected = projectTurn(state, withVariables(draft,result));
    expect(projected.npc['npc-a']).toMatchObject({locationId:'room-b',onScene:true});
    expect(projected.protagonist.locationId).toBe('room-b');
    expect(projected.organizations['bad-org']).toBeUndefined();
    expect(projected.organizations['mutual-a']).toEqual(mutualOrganization('mutual-a','mutual-b'));
    expect(projected.organizations['mutual-b']).toEqual(mutualOrganization('mutual-b','mutual-a'));
    expect(result.commands.map(command=>command.type)).toEqual(['UpdateNpc','CreateOrganization','UpdateProtagonist','CreateOrganization']);
  });

  it('未知约束触发的暂时失败可在后续合法覆盖后重新加入，应用顺序不变', async () => {
    const fixture = locationsForIsolation(), { state, draft } = fixture;
    const { id, ...bad } = mutualOrganization('bad-org','not-created');
    const result = await parseBatch([
      assign('items[item-a].locationId', wrongPlace),
      assign(`organizations[${id}]`,bad),
      assign('items[item-a].locationId','room-b'),
      assign('worldClock',isolationClock),
    ],fixture);
    expect(result.settlement).toMatchObject({accepted:3,skipped:[{commandIndex:1}]});
    expect(result.commands.map(command=>command.type)).toEqual(['SetWorldClock','UpdateItem','UpdateItem']);
    const projected = projectTurn(state,withVariables(draft,result));
    expect(projected.items['item-a'].locationId).toBe('room-b');
    expect(projected.worldClock).toBe(isolationClock);
  });

  it('World 因果环仍被拒绝，独立地点可落在合法投影', async () => {
    const fixture = locationsForIsolation(), { state, draft } = fixture;
    const based = withVariables(draft,await parseBatch([assign('worldClock',isolationClock)],fixture));
    const cycle = (id: string, prior: string) => stageCommand({...event(id),title:id, status:'resolved',
      startAt:isolationClock,estimatedEndAt:isolationClock,resolvedAt:isolationClock,
      resolutionText:'合成结束',outcome:'success',predecessorEventIds:[prior],sourceTurnIds:[draft.turnId]});
    const result = await parsePartialWorld(wrapUpdates(JSON.stringify({...worldResult(),
      worldCommands:[{type:'CreateLocation',commandId:'valid',evidence:'合成',location:{id:'valid-room',name:'独立样本地点'}}],
      eventCommands:[cycle('event-cycle-a','event-cycle-b'),cycle('event-cycle-b','event-cycle-a')],
    })),state,based);
    expect(result.settlement?.skipped.map(row=>row.commandIndex)).toEqual([1,2]);
    expect(result.eventCommands).toEqual([]);
    const projected = projectTurn(state,based,result.worldCommands);
    expect(projected.events).toEqual(state.events);
    expect(projected.locations['valid-room']).toMatchObject({name:'独立样本地点'});
  });

  it('只识别具体引用字段，忽略命令、回合、记忆自身和自由物品细节标识', () => {
    expect(structuredRefs({
      commandId:'not-entity',sourceTurnId:'not-turn-entity',
      event:{sourceTurnIds:['not-prerequisite'],continuation:{entry:{locationId:'event-room'}}},
      memory:{id:'not-memory-entity',sourceTurnIds:['not-history-entity'],affectedEntityRefs:[{kind:'npc',id:'actual-npc'}]},
      changes:{itemDetails:{locationId:'not-location'},ownerRef:{kind:'protagonist',id:'actual-owner'}},
    })).toEqual(['event-room','actual-npc','actual-owner']);
  });

  it('重复创建的地点失败时，Variables 和 World 仍可引用已存在的正式地点', async () => {
    const fixture = locationsForIsolation(), { state, draft } = fixture;
    const parsed = await parseBatch([
      assign('locations[room-b]',{name:'重复地点'}), npcMove, heroMove,
    ],fixture);
    expect(parsed.settlement).toMatchObject({accepted:2,skipped:[{commandIndex:0}]});
    const based = withVariables(draft,parsed);
    const world = await parsePartialWorld(wrapUpdates(JSON.stringify({...worldResult(),worldCommands:[
      {type:'CreateLocation',commandId:'duplicate-room',evidence:'合成',location:{id:'room-b',name:'重复地点'}},
      {type:'CreateLocation',commandId:'new-room',evidence:'合成',location:{id:'new-room',name:'合法子地点',parentId:'room-b'}},
    ]})),state,based);
    expect(world.settlement).toMatchObject({accepted:1,skipped:[{commandIndex:0}]});
    const projected = projectTurn(state,based,world.worldCommands);
    expect(projected.locations['room-b']).toEqual(state.locations['room-b']);
    expect(projected.locations['new-room'].parentId).toBe('room-b');
    expect(projected.npc['npc-a']).toMatchObject({locationId:'room-b',onScene:true});
  });

  it('后一条定位整对象失败时，前一合法移动仍可满足在场人物的地点依赖', async () => {
    const fixture = locationsForIsolation(), { state, draft } = fixture;
    const result = await parseBatch([npcMove,heroMove,assign('protagonist',{locationId:'room-b',emotionText:17})],fixture);
    expect(result.settlement).toMatchObject({accepted:2,skipped:[{commandIndex:2}]});
    const projected = projectTurn(state,withVariables(draft,result));
    expect(projected.protagonist.locationId).toBe('room-b');
    expect(projected.npc['npc-a']).toMatchObject({locationId:'room-b',onScene:true});
  });

  it('26 条合成命令只隔离第 4 条；投影、World、正式提交、重载和撤回保留各项预期变化', async () => {
    const fixture = locationsForIsolation(), {state,draft} = fixture;
    const commands = locationIsolationCommands();
    expect(commands).toHaveLength(26);
    const result = await parseBatch(commands, fixture);
    expect(result.settlement).toEqual({ accepted:25, skipped:[{...locationError, commandIndex:3, groupIndex:3}] });
    expect(JSON.stringify(result.settlement)).not.toMatch(new RegExp(`${wrongPlace}|item-a`));
    const readyVariables = withVariables(draft,result);
    const projected = projectTurn(state,readyVariables);
    const clean = await parseBatch(locationIsolationCommands(correctPlace), fixture);
    const cleanProjection = projectTurn(state,withVariables(draft,clean));
    expect(clean.settlement).toBeUndefined();
    expect(projected.worldClock).toBe(isolationClock);
    expect(projected.locations[correctPlace]).toEqual({id:correctPlace,name:'合成工作间',parentId:'place-parent'});
    expect(projected.locations[wrongPlace]).toBeUndefined();
    expect(projected.protagonist.locationId).toBe(correctPlace);
    expect(projected.protagonist.currentWear).toEqual({accessoryItemIds:[]});
    expect(projected.items['item-a']).toEqual(state.items['item-a']);
    expect(projected.items['item-b'].locationId).toBe(correctPlace);
    expect(projected.npc['npc-a']).toMatchObject({locationId:correctPlace,onScene:true,lastInteractionAt:isolationClock,
      affinity:35,relationshipText:'协作关系已建立'});
    for (const id of isolationNpcIds)
      expect(projected.npc[id]).toMatchObject({identityKey:`identity-${id}`,locationId:correctPlace,onScene:true});
    for (const id of ['new-a','new-b','npc-a'])
      expect(projected.npc[id].usualLocations).toEqual([{locationId:correctPlace,role:'work',knownToProtagonist:true}]);
    expect(projected.npc['new-a']).toMatchObject({relationshipNetwork:relationTo('new-b')});
    expect(projected.npc['new-b']).toMatchObject({relationshipNetwork:relationTo('new-a')});
    for (const id of ['npc-a',...isolationNpcIds]) {
      expect(projected.npc[id].memories).toHaveLength(1);
      expect(projected.npc[id].memories[0]).toMatchObject({text:`合成记忆 ${id}`,createdAtGameTime:isolationClock,
        sourceTurnIds:[draft.turnId],visibility:'npc_private'});
      const facts = (value: typeof projected.npc[string]) => ({...value,memories:value.memories.map(({id,...memory})=>({ ...memory, hasStableId:Boolean(id) }))});
      expect(facts(projected.npc[id])).toEqual(facts(cleanProjection.npc[id]));
    }

    const raw = {...worldResult(),worldCommands:[
      {type:'CreateLocation',commandId:'bad-place',evidence:'夹具',location:{id:'world-bad',name:'孤立地点',parentId:'missing-parent'}},
      {type:'CreateOrganization',commandId:'mutual-x',evidence:'夹具',organization:mutualOrganization('mutual-x','mutual-y')},
      {type:'CreateOrganization',commandId:'mutual-y',evidence:'夹具',organization:mutualOrganization('mutual-y','mutual-x')},
    ]};
    const world = await parsePartialWorld(wrapUpdates(JSON.stringify(raw)),state,readyVariables);
    expect(world.settlement).toEqual({ accepted:2, skipped:[{
      group:'worldCommands',commandIndex:0,groupIndex:0,category:'world',field:'parentId',reason:'reference',
    }]});
    const factory = new IDBFactory(), repo = await SaveRepository.open('location-isolation',factory);
    try {
      const input = {state,draft:readyVariables};
      await repo.importBackup(input,(await repo.compareBackup(input)).confirmation);
      const imported = (await repo.loadGame(state.saveId)).draft!;
      const ready = await repo.saveDraft(saveWorld(imported,world),imported.draftRevision);
      const commit = submission(ready,'收录合成更新');
      const once = await repo.commitTurn(commit);
      expect((await repo.commitTurn(commit)).replayed).toBe(true);
      expect(once.state.protagonist).toEqual(projected.protagonist);
      expect(once.state.items).toEqual(projected.items);
      expect(once.state.locations).toEqual(projected.locations);
      for (const id of Object.keys(projected.npc)) expect(once.state.npc[id]).toEqual(projected.npc[id]);
      expect(once.state.organizations['mutual-x']).toEqual(mutualOrganization('mutual-x','mutual-y'));
      expect(once.state.organizations['mutual-y']).toEqual(mutualOrganization('mutual-y','mutual-x'));
      expect(once.state.journal.at(-1)?.settlement).toMatchObject({variables:readyVariables.variables?.result.settlement,world:world.settlement});
      const reopened = await SaveRepository.open('location-isolation',factory);
      try {
        expect(await reopened.load(state.saveId)).toEqual(once.state);
        const undone = await reopened.undoTurn({saveId:state.saveId,expectedRevision:once.state.revision,expectedDraft:once.draft,operationId:'location-undo'});
        expect(undone.state.worldClock).toBe(state.worldClock);
        for (const field of ['npc','items','locations','protagonist','journal'] as const)
          expect(undone.state[field]).toEqual(state[field]);
      } finally { reopened.close(); }
    } finally { repo.close(); }
  });

  it('父地点确实缺失时隔离真正的依赖，保留时钟、互动、原地状态和装备更新', async () => {
    const fixture = locationsForIsolation(false), {state,draft} = fixture;
    const result = await parseBatch(locationIsolationCommands(), fixture);
    expect(result.settlement).toMatchObject({ accepted:8, skipped:expect.arrayContaining([
      {group:'variables',commandIndex:1,groupIndex:1,category:'state',field:'parentId',reason:'reference'},
      {group:'variables',commandIndex:3,groupIndex:3,category:'item',field:'locationId',reason:'reference'},
      {group:'variables',commandIndex:4,groupIndex:4,category:'item',reason:'dependency'},
    ]) });
    expect(result.settlement?.skipped.map(s=>s.commandIndex)).toEqual([1,2,3,4,5,10,11,12,13,14,15,16,17,18,20,21,22,23]);
    const projected = projectTurn(state, withVariables(draft,result));
    expect(projected.worldClock).toBe(isolationClock);
    expect(projected.locations).toEqual(state.locations);
    expect(projected.items).toEqual(state.items);
    expect(projected.protagonist.locationId).toBe('room-a');
    expect(projected.protagonist.currentWear).toEqual({accessoryItemIds:[]});
    expect(Object.keys(projected.npc)).toEqual(Object.keys(state.npc));
    expect(projected.npc['npc-a']).toMatchObject({locationId:'room-a',onScene:true,lastInteractionAt:isolationClock,
      affinity:35,relationshipText:'协作关系已建立',memories:[{text:'合成记忆 npc-a'}]});
  });
});
