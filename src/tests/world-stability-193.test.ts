import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestFixtureStage } from './fixtures/stageRequest';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { defaultSettings } from '../ui/settings/model';
import { endStage, stageCommand, stageContext, subStage } from './fixtures/eventStages';
import { event, task } from './fixtures/game';
import { worldDraft, worldResult, worldState } from './fixtures/world';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { saveFixtureStory, submission } from './fixtures/turn';

function echoFixture() {
  const a = stageContext();
  const closed = endStage(subStage('already-closed'));
  closed.sourceTurnIds = ['earlier-turn'];
  a.state.events[closed.id] = closed;
  a.state.worldClock = closed.resolvedAt!;
  a.response.eventCommands = [stageCommand(closed), stageCommand(endStage(a.state.events['stage-one']))];
  a.state = GameStateSchema.parse(a.state);
  return { ...a, closed };
}

it('精确重放已正式结案的事件可忽略，其他到期事件仍必须结案并重验', () => {
  const { state, draft, response, closed } = echoFixture();
  const before = structuredClone(state), raw = structuredClone(response);
  const normalized = parseWorld(JSON.stringify(response), state, draft);
  expect(normalized.eventCommands).toEqual([response.eventCommands[1]]);
  expect(worldNormalizationNotes.get(normalized)).toEqual([
    'eventCommands.0（SaveEvent）与已正式结案的事件完全相同，未重复写入。',
  ]);
  expect(parseWorld(JSON.stringify(normalized), state, draft)).toEqual(normalized);
  const projected = projectTurn(state, draft, normalized.eventCommands);
  expect(projected.events[closed.id]).toEqual(before.events[closed.id]);
  expect(projected.events['stage-one']).toMatchObject({status:'resolved',resolvedAt:'2027-01-03T00:00:00+08:00'});
  expect(projected.appliedCommands).not.toContainEqual(expect.objectContaining({commandId:'write:already-closed'}));
  expect(state).toEqual(before);
  expect(response).toEqual(raw);
  expect(() => parseWorld(JSON.stringify({...raw,eventCommands:[raw.eventCommands[0]]}),state,draft)).toThrow(
    expect.objectContaining({details:expect.objectContaining({worldRule:'stage_due'})}));
});

it('正式 Repository 重验终态复述后的候选，只结算真实事件，重交幂等',async () => {
  const { state,draft,response,closed } = echoFixture();
  const repo=await SaveRepository.open('world-193-replay',new IDBFactory());
  try {
    await repo.create(state);
    const blank=await repo.saveDraft(createTurnDraft(state.saveId,state.revision,draft.turnId,'opening',''),null);
    const story=await saveFixtureStory(repo,rerollStory(blank,draft.story!),blank.draftRevision);
    const variables=await repo.saveDraft({...draft,draftRevision:story.draftRevision+1},story.draftRevision);
    const result=parseWorld(JSON.stringify(response),state,variables);
    const prepared=await repo.saveDraft({...variables,draftRevision:variables.draftRevision+1,
      world:{storyRevision:variables.storyRevision,candidateRevision:1,requestRevision:0,
        basedOnVariableRevision:variables.variables!.candidateRevision,validation:'validated',result},
      stageStatus:{...variables.stageStatus,world:'ready'}},variables.draftRevision);
    expect(await repo.load(state.saveId)).toEqual(state);
    const committed=await repo.commitTurn(submission(prepared));
    expect(committed.state.events[closed.id]).toEqual(closed);
    expect(committed.state.events['stage-one'].status).toBe('resolved');
    expect(committed.state.appliedCommands).not.toContainEqual(expect.objectContaining({commandId:'write:already-closed'}));
    expect((await repo.commitTurn(submission(prepared))).replayed).toBe(true);
    expect(await repo.load(state.saveId)).toEqual(committed.state);
  } finally { repo.close(); }
});

it('既有终态只接受全记录等价，修改结局仍拒绝并保留原命令下标', () => {
  const { state,draft,response,closed } = echoFixture();
  response.eventCommands.push(stageCommand({...closed,id:'new-wrong-time',title:'新的独立事件',
    startAt:'2027-01-03T00:00:00+08:00',fixedEndAt:'2027-01-04T00:00:00+08:00',sourceTurnIds:[draft.turnId]}));
  expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'event_time',fieldPath:'eventCommands.2.event.resolvedAt',commandIndex:2,commandType:'SaveEvent',
  })}));
  response.eventCommands = [stageCommand({...closed,resolutionText:'不同结果'}), response.eventCommands[1]];
  expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'event_transition',fieldPath:'eventCommands.0.event.resolutionText',commandIndex:0,commandType:'SaveEvent',
  })}));
});

it('同批新任务的相同身份仍拒绝，诊断定位第二条并且不输出原文、命令ID或实体值', () => {
  const state = worldState(), draft = worldDraft(), response = worldResult();
  const planned = {...task('original-private-id'),actorRef:{kind:'npc' as const,id:'npc-a'},goal:'ONLY_IN_MODEL_GOAL',status:'active' as const,dueAt:'2026-10-18T09:00:00+08:00'};
  response.taskCommands = [planned,{...planned,id:'second-private-id'}].map((task,index)=>({
    type:'SaveTask',commandId:`private-command-${index}`,evidence:'ONLY_IN_MODEL_RESPONSE',task,
  }));
  let failure: unknown;
  try { parseWorld(JSON.stringify(response),state,draft); } catch (error) { failure = error; }
  expect(failure).toMatchObject({details:{worldRule:'task_duplicate',fieldPath:'taskCommands.1.task.goal',commandIndex:1,commandType:'SaveTask'}});
  const log = runtimeLogEvent(1,'world','failed',failure);
  expect(log).toMatchObject({worldRule:'task_duplicate',fieldPath:'taskCommands.1.task.goal',commandIndex:2,commandType:'SaveTask'});
  expect(JSON.stringify(log)).not.toMatch(/ONLY_IN_MODEL|private-/);
  expect(state.tasks).toEqual({});
  const [first,second] = response.taskCommands;
  if (second.type !== 'SaveTask') throw new Error('测试夹具应包含新任务');
  const distinct = {...second,task:{...second.task,dueAt:'2026-10-18T10:00:00+08:00'}};
  expect(parseWorld(JSON.stringify({...response,taskCommands:[first,distinct]}),state,draft).taskCommands)
    .toEqual([first,distinct]);
});

it('无害重放不可隐藏命令 ID 冲突或同一事件双写', () => {
  const { state,draft,response,closed } = echoFixture();
  const original = [...response.eventCommands];
  response.eventCommands.push({...original[0],commandId:'stage-clock'});
  const validate = () => parseWorld(JSON.stringify(response),state,draft);
  expect(validate).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'command_structure',fieldPath:'eventCommands.2.commandId',commandIndex:2,commandType:'SaveEvent',
  })}));
  response.eventCommands = [...original, {...stageCommand({...closed,resolutionText:'不同事实'}),commandId:'another-write'}];
  expect(validate).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'command_structure',fieldPath:'eventCommands.2.event.id',commandIndex:2,commandType:'SaveEvent',
  })}));
});

it('沿用既有事件重复拒绝，未知前序定位到具体验证字段', () => {
  const state = worldState(), draft = worldDraft(), response = worldResult();
  const planned = {...event('later-one'),title:'合成事件',status:'scheduled' as const,startAt:'2026-10-18T10:00:00+08:00',
    estimatedEndAt:'2026-10-18T11:00:00+08:00',sourceTurnIds:[draft.turnId]};
  state.events[planned.id] = {...planned,sourceTurnIds:['older-turn']};
  response.eventCommands = [stageCommand({...planned,id:'later-two'})];
  const validate = () => parseWorld(JSON.stringify(response),state,draft);
  expect(validate).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'entity_id',fieldPath:'eventCommands.0.event.id',commandIndex:0,commandType:'SaveEvent',
  })}));
  response.eventCommands = [stageCommand({...planned,id:'independent-event',title:'另一个事件',predecessorEventIds:['anonymous-private-id']})];
  expect(validate).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'event_reference',fieldPath:'eventCommands.0.event.predecessorEventIds.0',commandIndex:0,commandType:'SaveEvent',
  })}));
});

it.each([undefined, 0, 0.35])('World 实际请求沿用路由渠道的 temperature %s，未设置时省略', async temperature => {
  const story = newChannel(), world = {...newChannel(),parameters:{temperature,maxOutputTokens:8192}};
  story.parameters.temperature = 1.6;
  const config = defaultAiConfig();
  config.channels = [story, world];
  config.routes.story = {channelId:story.id,modelId:'mock-story'};
  config.routes.world = {mode:'independent',channelId:world.id,modelId:'mock-world'};
  const storage = {getItem: () => 'mock-secret',setItem:()=>{},removeItem:()=>{}};
  const vault = new CredentialVault(storage,storage);
  const transport = vi.fn<typeof fetch>(async () => Response.json({choices:[{message:{content:JSON.stringify(worldResult())},finish_reason:'stop'}]}));
  await requestFixtureStage({stage:'world',mode:'regular',state:worldState(),draft:worldDraft(),
    userInput:'',settings:defaultSettings()},config,vault,{stream:false},new AiClient(transport));
  expect(transport).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
  expect(body).toMatchObject({model:'mock-world', stream:false});
  expect(body).not.toHaveProperty('tools');
  if (temperature === undefined) expect(body).not.toHaveProperty('temperature');
  else expect(body).toHaveProperty('temperature',temperature);
});
