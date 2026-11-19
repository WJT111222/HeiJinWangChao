import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { TurnDraftSchema, rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { worldEventSchedule } from '../domain/events/schedule';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { SaveRepository } from '../services/storage/saveRepository';
import { revalidateWorld } from '../services/validation/aiOutputs';
import { parsePartialVariables, parsePartialWorld } from '../services/validation/partialOutputs';
import { defaultSettings } from '../ui/settings/model';
import { stageCommand } from './fixtures/eventStages';
import { handoffDeadline, issue194 } from './fixtures/issue194';
import { task } from './fixtures/game';
import { submission } from './fixtures/turn';
import { worldResult } from './fixtures/world';

const wrap = (commands: string) => `<thinking>合成说明不执行。</thinking><说明>准备登记变化。</说明><命令>\n${commands}\n</命令>`;
const item = { name:'合成便条', category:'document', quantity:1, conditionText:'完整' };
const emotion = 'set protagonist.emotionText = "平静"';
const makeItem = `set items[note] = ${JSON.stringify(item, null, 2)}`;
const buy = `set items[purchase].purchase = ${JSON.stringify({account:'cash',price:50,item})}`;

function withVariables(draft: TurnDraft, result: NonNullable<TurnDraft['variables']>['result']) {
  return TurnDraftSchema.parse({...draft,variables:{...draft.variables,result},world:undefined,
    stageStatus:{...draft.stageStatus,variables:'ready',world:'pending'}});
}
function saveWorld(draft: TurnDraft, result: NonNullable<TurnDraft['world']>['result']) {
  return TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1,stageStatus:{...draft.stageStatus,world:'ready'},
    world:{storyRevision:draft.storyRevision,candidateRevision:1,requestRevision:draft.stageRequestRevisions.world,
      basedOnVariableRevision:draft.variables!.candidateRevision,validation:'validated',result}});
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
