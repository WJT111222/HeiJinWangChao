import { describe, expect, it } from 'vitest';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { settleTurn } from '../domain/turnCommit';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { prepareErrorPayload } from '../services/feedback/report';
import { feedbackSchema } from '../services/feedback/contract';
import { parseEntities } from '../services/validation/aiOutputs';
import { parsePartialEntities, parsePartialVariables, parsePartialWorld } from '../services/validation/partialOutputs';
import { historyState } from './fixtures/history';
import { npc, organizations, story, task } from './fixtures/game';
import { variableTextEnvelope } from './fixtures/variableReply';
import { actionTime, projectedTime, worldResult, worldState } from './fixtures/world';

const envelope = (lines: string[]) => variableTextEnvelope('<说明>记录本幕现场变化。</说明>\n<命令>\n' + lines.join('\n') + '\n</命令>');
const response = (contacts: string[], lines: string[]) => '<接触者>' + JSON.stringify(contacts) + '</接触者>' + envelope(lines);
const memory = (id: string) => 'push npc[' + id + '].memories = ' + JSON.stringify({
  text: '收到了会议资料。', knowledgeKind: 'observed', knowledgeSource: '本人在场', visibility: 'npc_private',
});
function create(overrides = {}) {
  const { id, ...fields } = npc('visitor');
  return 'set npc[' + id + '] = ' + JSON.stringify({ ...fields, name: '来访者', ...overrides });
}
function context() {
  const state = { ...worldState(), revision:1, turnNumber:1, journal:historyState(1).journal };
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'contact-test', 'regular', ''), story);
  return { state, draft };
}

describe('人物阶段的接触声明和有效候选', () => {
  it.each(['逐条互动', '统一追加记忆', '先迁移地点'] as const)('%s：隔离遗漏接触许可的已有 NPC，保留新建、记忆与离场', async variant => {
    const { state, draft } = context();
    const returning = ['set npc[npc-a].locationId = "chongqing"', 'set npc[npc-a].onScene = true'];
    state.locations.station = {id:'station',name:'车站'};
    const destination = variant === '统一追加记忆' ? null : 'station';
    const leaving = ['set npc[scene].onScene = false', 'set npc[scene].locationId = ' + JSON.stringify(destination)];
    if (variant === '先迁移地点') leaving.reverse();
    if (variant !== '先迁移地点') returning.push('set npc[npc-a].affinityChange = {"to":33,"reason":"再次见面","relationshipText":"旧识"}');
    returning.push('set npc[npc-a].lastInteractionAt = "' + actionTime + '"');
    leaving.push('set npc[scene].lastInteractionAt = "' + actionTime + '"');
    const common = {gender:'female',identity:'联络员',appearance:'戴眼镜',temperament:'平和'};
    const arrival = [create(variant === '逐条互动' ? {...common,age:30,background:'资料整理',healthText:'良好'}
      : variant === '先迁移地点' ? {...common,affinityConfirmed:true,healthText:'良好'} : common)];
    if (variant === '逐条互动') {
      arrival.push('set npc[visitor].lastInteractionAt = "' + actionTime + '"');
      returning.unshift('set npc[npc-a].gender = "male"');
    }
    const lines = variant === '统一追加记忆' ? [...arrival, ...returning, ...leaving, memory('scene'), memory('npc-a'), memory('visitor')]
      : [...arrival, memory('visitor'), ...returning, memory('npc-a'), ...leaving, memory('scene')];
    const { contactedNpcIds, ...result } = await parsePartialEntities(response(['visitor'], lines), state, draft);
    expect(contactedNpcIds).toEqual(['visitor']);
    expect(result.settlement?.skipped.map(row => [row.commandIndex, row.reason])).toEqual(
      lines.flatMap((line, i) => line.includes('npc[npc-a]') ? [[i, 'permission']] : []));
    const saved = TurnDraftSchema.parse(JSON.parse(JSON.stringify({ ...draft, useWorldStage:false,
      entities:{ result, contactedNpcIds, validation:'structural', storyRevision:1, candidateRevision:1, requestRevision:0 },
      stageStatus:{...draft.stageStatus,entities:'ready',world:'skipped'} })));
    const scene = await parsePartialVariables(envelope(['set worldClock = "' + projectedTime + '"']), state, saved);
    const ready = TurnDraftSchema.parse({...saved, variables:{result:scene,validation:'validated',storyRevision:1,candidateRevision:2,requestRevision:0,basedOnEntityRevision:1},stageStatus:{...saved.stageStatus,variables:'ready'}});
    const next = settleTurn(state,ready,state.updatedAt);
    expect(next.npc).toEqual(projectTurn(state,ready).npc);
    expect(next.npc.visitor.memories).toHaveLength(1);
    expect(next.npc.scene.onScene).toBe(false);
    expect(next.npc.scene.locationId).toBe(destination ?? undefined);
    expect(next.npc.scene.memories).toHaveLength(1);
    expect(next.npc['npc-a']).toEqual(state.npc['npc-a']);
    expect(state.npc.visitor).toBeUndefined();
    expect(next.revision).toBe(state.revision + 1);
  });

  it.each([{locationId:'unknown-place'}, {identityKey:'identity-scene'}])('无效建档及依赖的个人记忆一起隔离 %j', async invalid => {
    const {state, draft} = context();
    const {contactedNpcIds, ...result} = await parsePartialEntities(response(['npc-a','visitor'], [
      create(invalid), memory('visitor'), 'set npc[scene].onScene = false',
    ]),state,draft);
    expect(contactedNpcIds).toEqual(['npc-a']);
    expect(result.commands.map(c=>c.type)).toEqual(['UpdateNpc']);
    expect(result.settlement?.skipped.map(x=>x.commandIndex)).toEqual([0,1]);
    expect(result.settlement?.skipped[1].reason).toBe('dependency');
    const restored = TurnDraftSchema.parse({...draft,entities:{contactedNpcIds,result,storyRevision:1,candidateRevision:1,requestRevision:0,validation:'structural'},stageStatus:{...draft.stageStatus,entities:'ready'}});
    const job = {...task(),actorRef:{kind:'npc',id:'visitor'}};
    const {id,...fields} = job;
    await expect(parsePartialVariables(envelope(['set tasks['+id+'] = '+JSON.stringify(fields)]),state,restored)).rejects.toMatchObject({code:'ENTITY_DEPENDENCY'});
    await expect(parsePartialWorld(JSON.stringify({...worldResult(),taskCommands:[{type:'SaveTask',commandId:'job',evidence:'约定',task:job}]}),state,restored)).rejects.toMatchObject({code:'ENTITY_DEPENDENCY'});
    const staleScene = TurnDraftSchema.parse({...restored,useWorldStage:false,variables:{
      storyRevision:1,candidateRevision:2,requestRevision:0,basedOnEntityRevision:1,validation:'validated',
      result:{commands:[{type:'SaveTask',commandId:'job',evidence:'约定',task:job}],unresolved:[],rejectedSuggestions:[]},
    },stageStatus:{...restored.stageStatus,variables:'ready',world:'skipped'}});
    expect(() => settleTurn(state,staleScene,state.updatedAt)).toThrowError(expect.objectContaining({code:'ENTITY_DEPENDENCY'}));
    expect(state.tasks[job.id]).toBeUndefined();
    expect(state.revision).toBe(1);
  });

  it.each([
    { declared:false, validCreator:true },
    { declared:true, validCreator:true },
    { declared:true, validCreator:false },
  ])('补报：待完善的特殊档案引用同批新人物 %j', async ({declared, validCreator}) => {
    const {state, draft} = context();
    const owner = state.npc['npc-a'];
    if (owner.kind !== 'special') throw new Error('测试需要特殊人物');
    owner.profilePending = true;
    owner.detailedBackground = '';
    owner.activeGoals = [];
    const profile = { detailedBackground:'合成经历', activeGoals:['完成交接'], habits:[], offscreenTaskIds:[],
      relationshipNetwork:[{name:'来访者', relationship:'合作者', description:'共同交接', affinity:null, npcId:'visitor'}] };
    const lines = [
      create(validCreator ? {lastInteractionAt:actionTime} : {locationId:'absent-place'}), memory('visitor'),
      'set npc[npc-a].locationId = "chongqing"', 'set npc[npc-a].onScene = true',
      'set npc[npc-a].relationshipText = "合作者"', 'set npc[npc-a].lastInteractionAt = "' + actionTime + '"',
      'set npc[npc-a].specialProfile = ' + JSON.stringify(profile), memory('npc-a'),
    ];
    const parsed = await parsePartialEntities(response(declared ? ['visitor','npc-a'] : ['visitor'], lines),state,draft);
    expect(parsed.contactedNpcIds).toEqual([...(validCreator ? ['visitor'] : []), ...(declared ? ['npc-a'] : [])]);
    const types = parsed.commands.map(command => command.type);
    expect(types.includes('CreateNpc')).toBe(validCreator);
    expect(types.includes('PromoteNpc')).toBe(declared && validCreator);
    expect(types.filter(type => type === 'RecordNpcMemory')).toHaveLength(Number(validCreator) + Number(declared));
    const skipped = parsed.settlement?.skipped ?? [];
    expect(skipped.map(row => row.commandIndex)).toEqual(!declared ? [2,3,4,5,6,7] : validCreator ? [] : [0,1,6]);
    if (declared && !validCreator) expect(skipped.at(-1)?.reason).toBe('dependency');
    expect(owner.profilePending).toBe(true);
    if (declared && validCreator) {
      for (const [npcId, rule] of [['missing-person','missing_person'], ['npc-a','self_relationship']]) {
        const invalid = lines.map((line, index) => index === 6 ? 'set npc[npc-a].specialProfile = ' + JSON.stringify({
          ...profile, relationshipNetwork:[{ ...profile.relationshipNetwork[0], npcId }],
        }) : line);
        const text = response(['visitor','npc-a'], invalid);
        await expect(parseEntities(text,state,draft)).rejects.toMatchObject({details:{commandIndex:6,domainRule:rule}});
        const partial = await parsePartialEntities(text,state,draft);
        expect(partial.settlement?.skipped.map(row => row.commandIndex)).toEqual([6]);
        expect(partial.commands.filter(command => command.type === 'RecordNpcMemory')).toHaveLength(2);
      }
      // A pending profile can still contain an established fact. Contact never licenses overwriting it.
      owner.detailedBackground = '已保存的资料';
      const text = response(['visitor','npc-a'], lines);
      await expect(parseEntities(text,state,draft)).rejects.toMatchObject({details:{
        commandIndex:6, commandType:'PromoteNpc', domainRule:'npc_profile_conflict', valuePath:'npc[id].specialProfile',
      }});
      expect((await parsePartialEntities(text,state,draft)).settlement?.skipped).toMatchObject([{commandIndex:6,reason:'conflict'}]);
    }
  });

  it('未知声明不因空试验或无关实体的同名创建而获准', async () => {
    const {state,draft} = context();
    for (const lines of [[], ['set locations[absent] = {"name":"候车室"}']]) {
      await expect(parsePartialEntities(response(['absent'],lines),state,draft)).rejects.toMatchObject({
        code:'data_integrity',details:{variableStep:'simulation',domainRule:'missing_contact_declaration_target'},
      });
    }
  });

  it('整批约束需要空集合与分组试验时，只随选入的建档授权，保留已有无更新接触者', async () => {
    const {state,draft} = context();
    const {id,...org} = organizations[3];
    const lines = [create(), 'set organizations['+id+'] = '+JSON.stringify({...org,keyNpcIds:['no-member']}), memory('visitor')];
    const result = await parsePartialEntities(response(['npc-a','visitor'],lines),state,draft);
    expect(result.contactedNpcIds).toEqual(['npc-a','visitor']);
    expect(result.commands.map(c=>c.type)).toEqual(['CreateNpc','RecordNpcMemory']);
    expect(result.settlement?.skipped).toMatchObject([{commandIndex:1,reason:'reference'}]);
    // Neither link in the cycle is individually responsible. The verifier must also validate an empty trial.
    const cycle = await parsePartialEntities(response(['npc-a','visitor'],[create(),
      'set locations[one] = {"name":"地点一","parentId":"two"}',
      'set locations[two] = {"name":"地点二","parentId":"one"}',memory('visitor')]),state,draft);
    expect(cycle.contactedNpcIds).toEqual(['npc-a','visitor']);
    expect(cycle.commands.map(command => command.type)).toEqual(['CreateNpc','RecordNpcMemory']);
    expect(cycle.settlement?.skipped.map(row => row.commandIndex)).toEqual([1,2]);
  });

  it('重复建档不占用正式人物已有的权限或合法变更', async () => {
    const {state,draft} = context();
    const result = await parsePartialEntities(response(['scene'],[
      create().replace('npc[visitor]', 'npc[scene]'), memory('scene'),
    ]),state,draft);
    expect(result.contactedNpcIds).toEqual(['scene']);
    expect(result.commands.map(c=>c.type)).toEqual(['RecordNpcMemory']);
    expect(result.settlement?.skipped).toMatchObject([{commandIndex:0,reason:'conflict'}]);
    expect(result.rejectedSuggestions).toEqual([]);
  });

  it('阶段模拟诊断经运行日志及反馈 Schema，使用原始文本序号，排除实体 ID 和剧情', async () => {
    const {state,draft} = context();
    for (const [lines, contacts, expected] of [
      [[create(), memory('visitor'), 'set npc[npc-a].onScene = true'], ['visitor'],
        {commandIndex:3,commandType:'UpdateNpc',valuePath:'npc[id].onScene',domainRule:'contact_permission'}],
      // Compiler sorts the clock first, but the offending clock was the second text command.
      [[create(), 'set worldClock = "'+projectedTime+'"'], ['visitor'],
        {commandIndex:2,commandType:'SetWorldClock',valuePath:'worldClock',domainRule:'stage_permission'}],
      [[create({locationId:'private-place'})], ['visitor'], {commandIndex:1,commandType:'CreateNpc',domainRule:'missing_location'}],
      [[create({identityKey:'identity-scene'})], ['visitor'], {commandIndex:1,commandType:'CreateNpc',domainRule:'duplicate_npc_identity'}],
      [[], ['private-contact'], {domainRule:'missing_contact_declaration_target',fieldPath:'contactedNpcIds'}],
    ] as const) {
      const failure: unknown = await parseEntities(response([...contacts],[...lines]),state,draft).then(()=>null, e=>e);
      const log = runtimeLogEvent(1,'entities','failed',failure);
      expect(log).toMatchObject({stage:'entities',variableStep:'simulation',validationRule:'domain_schema',...expected});
      const report = prepareErrorPayload([log],[],{content:false,reasoning:false})('');
      expect(feedbackSchema.safeParse(report).success).toBe(true);
      expect(report.errors[0]).toMatchObject(expected);
      if (!('commandIndex' in expected)) expect(report.errors[0].commandIndex).toBeUndefined();
      expect(report.attachments).toBeUndefined();
      expect(JSON.stringify(report)).not.toMatch(/private-place|private-contact|visitor|收到.*资料|identity-scene/);
    }
  });

  it('同一省略名单在原本已在场的基线上无需补权，非法地点只跳过该字段', async () => {
    const {state,draft} = context();
    state.npc['npc-a'].onScene = true;
    const result = await parsePartialEntities(response(['visitor'],[create(), 'set npc[npc-a].locationId = "missing-place"',
      'set npc[npc-a].onScene = true',memory('npc-a'),memory('visitor')]),state,draft);
    expect(result.contactedNpcIds).toEqual(['visitor']);
    expect(result.settlement?.skipped).toMatchObject([{commandIndex:1,field:'locationId',reason:'reference'}]);
    expect(result.commands.map(c=>c.type)).toEqual(['CreateNpc','UpdateNpc','RecordNpcMemory','RecordNpcMemory']);
  });

  it('已声明的重新到场者及回合开始就在场的人物可正常更新，接触但无命令的声明也保留', async () => {
    const {state,draft} = context();
    const text = response(['visitor','npc-a','scene'],[create(), 'set npc[npc-a].onScene = true', memory('npc-a'), memory('visitor')]);
    const full = await parseEntities(text,state,draft);
    expect(await parsePartialEntities(text,state,draft)).toEqual(full);
    expect(full.contactedNpcIds).toEqual(['visitor','npc-a','scene']);
    expect(full.commands.map(c=>c.type)).toEqual(['CreateNpc','UpdateNpc','RecordNpcMemory','RecordNpcMemory']);
  });
});
