import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { issue194, handoffDeadline } from './fixtures/issue194';
import { stageCommand } from './fixtures/eventStages';
import { submission } from './fixtures/turn';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { worldEventSchedule } from '../domain/events/schedule';
import { EventInteractionSchema } from '../domain/events/schema';
import { projectTurn } from '../domain/turnProjection';

const parse = (a: ReturnType<typeof issue194>) => parseWorld(JSON.stringify(a.response), a.state, a.draft);
const errorShape = (eventEntryReason: string, index: number, field: string, code = 'invalid_output') => ({
  code,
  details: { worldRule: 'event_entry', eventEntryReason, fieldPath: `eventCommands.${index}.event.${field}`, commandIndex: index, commandType: 'SaveEvent' },
});

it('到期 presented 即使选择 end 也须承接，读取汇报不会自动产生回执', () => {
  const a = issue194(), before = structuredClone(a.state);
  expect(() => parse(a)).toThrow(expect.objectContaining({ code: 'invalid_output', details: expect.objectContaining({ worldRule: 'event_entry' }) }));
  expect(projectTurn(a.state, a.draft).events[a.source.id].protagonistEntry).toEqual(a.source.protagonistEntry);
  expect(a.state).toEqual(before);
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('missing_successor', 0, 'protagonistEntry')));
});

it('唯一合法后继通过提交前重验、正式提交与重载；非法候选仍不写正式世界', async () => {
  const a = issue194();
  const repo = await SaveRepository.open('issue194', new IDBFactory());
  try {
    const seed = { state: a.state, draft: a.draft };
    await repo.importBackup(seed, (await repo.compareBackup(seed)).confirmation);
    a.draft = (await repo.loadGame(a.state.saveId)).draft!;
    const save = (result: ReturnType<typeof parse>) => repo.saveDraft({
      ...a.draft, draftRevision: a.draft.draftRevision + 1, stageStatus: { ...a.draft.stageStatus, world: 'ready' },
      world: { storyRevision: a.draft.storyRevision, candidateRevision: (a.draft.world?.candidateRevision ?? 0) + 1, requestRevision: 0,
        basedOnVariableRevision: a.draft.variables!.candidateRevision, validation: 'validated', result },
    }, a.draft.draftRevision);
    a.draft = await save(a.response);
    const before = await repo.loadGame(a.state.saveId);
    await expect(repo.commitTurn(submission(a.draft, a.draft.userInput))).rejects.toThrow();
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);

    a.response.eventCommands.push(stageCommand(a.successor));
    const normalized = parse(a);
    expect(parseWorld(JSON.stringify(normalized), a.state, a.draft)).toEqual(normalized);
    const ready = await save(normalized);
    const saved = await repo.commitTurn(submission(ready, ready.userInput));
    expect(saved.state.events[a.source.id]).toMatchObject({ status: 'resolved', resolvedAt: handoffDeadline, protagonistEntry: { status: 'invalidated' } });
    expect(saved.state.events[a.successor.id].protagonistEntry).toEqual({ ...a.source.protagonistEntry, id: expect.stringMatching(/^stage-entry:\d+$/) });
    expect(saved.state.protagonist).toEqual(a.state.protagonist);
    const later = { ...saved.state, worldClock: '2026-05-17T17:00:00+08:00' };
    expect(worldEventSchedule(saved.state, later).due).toEqual([]);
    expect(saved.state.revision).toBe(before.state.revision + 1);
    expect((await repo.commitTurn(submission(ready, ready.userInput))).replayed).toBe(true);
    expect((await repo.loadGame(a.state.saveId)).state).toEqual(saved.state);
    const restored = await repo.undoTurn({ saveId: a.state.saveId, expectedRevision: saved.state.revision, expectedDraft: saved.draft, operationId: 'handoff-undo' });
    expect(restored.state.events).toEqual(before.state.events);
    expect(restored.state.journal).toEqual(before.state.journal);
    expect(restored.state.worldClock).toBe(before.state.worldClock);
  } finally { repo.close(); }
});

it('不唯一、非新建、错误方向、承接字段不匹配及伪造回执均拒绝，并定位候选', () => {
  const a = issue194();
  a.response.eventCommands.push(stageCommand(a.successor), stageCommand({ ...a.successor, id: 'second-successor' }));
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('multiple_successors', 0, 'protagonistEntry')));

  a.state.events[a.successor.id] = { ...a.successor, predecessorEventIds: [], sourceTurnIds: a.source.sourceTurnIds };
  a.response.eventCommands.pop();
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('invalid_successor', 1, 'id', 'permission')));
  delete a.state.events[a.successor.id];

  a.response.eventCommands[1] = stageCommand({ ...a.successor, status: 'resolved', resolvedAt: handoffDeadline, resolutionText: '合成终态' });
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('invalid_successor', 1, 'status')));
  a.response.eventCommands[1] = stageCommand({ ...a.successor, continuation: { direction: 'end', reason: '没有承接安排' } });
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('mismatched_direction', 1, 'continuation.direction')));
  a.response.eventCommands[1] = stageCommand({ ...a.successor, continuation: { ...a.successor.continuation, entry: { ...a.successor.continuation.entry, cue: '不会进入日志的合成通知' } } });
  a.response.worldCommands.push({ type: 'CreateLocation', commandId: 'new-location', evidence: '合成场外地点', location: { id: 'sample-location', name: '样本地点' } });
  let failure: unknown;
  try { parse(a); } catch (error) { failure = error; }
  const mismatch = errorShape('mismatched_entry', 1, 'continuation.entry.cue', 'permission');
  expect(failure).toMatchObject({ ...mismatch, details: { ...mismatch.details, commandIndex: 2 } });
  const log = runtimeLogEvent(1, 'world', 'failed', failure);
  expect(log).toMatchObject({ worldRule: 'event_entry', commandIndex: 3 });
  expect(log.message).toContain('后继互动的入场字段与原安排不一致');
  expect(JSON.stringify(log)).not.toMatch(/不会进入日志的合成通知|请核对样本清单|handoff-source/);
  a.response.eventCommands[1] = stageCommand(a.successor);
  a.response.eventCommands[0] = stageCommand({ ...a.terminal, protagonistEntry: {
    ...a.source.protagonistEntry, status: 'declined', handledTurnId: a.draft.turnId, textEvidence: '伪造的玩家回应',
  } });
  const forged = errorShape('forged_entry', 0, 'protagonistEntry', 'permission');
  expect(() => parse(a)).toThrow(expect.objectContaining({ ...forged, details: { ...forged.details, commandIndex: 1 } }));
});

it('纯汇报已播放也不能由程序猜测回执，旧 presented 原样读取', () => {
  const a = issue194();
  const event = a.state.events[a.source.id];
  event.protagonistEntry!.cue = '告知资料已归档，无需回应。';
  const before = structuredClone(event);
  expect(EventInteractionSchema.safeParse({ eventId: event.id, entryId: event.protagonistEntry!.id, action: 'acknowledged' }).success).toBe(false);
  expect(() => parse(a)).toThrow(expect.objectContaining(errorShape('missing_successor', 0, 'protagonistEntry')));
  expect(projectTurn(a.state, a.draft).events[event.id]).toEqual(before);
  expect(a.state.events[event.id]).toEqual(before);
});

it('尚未呈现的 pending 按原例外失效；本轮合法 Story 回执关闭后不再承接', () => {
  const pending = issue194('pending');
  expect(parse(pending).eventCommands[0]).toMatchObject({ event: { protagonistEntry: { status: 'invalidated' } } });
  const a = issue194();
  a.draft.story!.variableGuide.push({ group: 'event', observedFact: '明确拒绝了核对请求', textEvidence: '主角明确拒绝了核对请求',
    eventInteraction: { eventId: a.source.id, entryId: a.source.protagonistEntry.id, action: 'declined' } });
  a.draft.story!.narrative = '十分钟后，主角明确拒绝了核对请求。';
  const normalized = parse(a);
  const projected = projectTurn(a.state, a.draft, normalized.eventCommands);
  expect(projected.events[a.source.id].protagonistEntry?.status).toBe('declined');
  expect(parseWorld(JSON.stringify(normalized), a.state, a.draft)).toEqual(normalized);
  expect(Object.keys(projected.events)).toEqual(Object.keys(a.state.events));
  a.draft.story!.variableGuide.push(a.draft.story!.variableGuide[0]);
  expect(() => parse(a)).toThrow();
  expect(a.state.events[a.source.id].protagonistEntry?.status).toBe('presented');
});

async function composedWorld(a: ReturnType<typeof issue194>) {
  const prompt = await composePrompt({ stage: 'world', mode: 'regular', state: a.state, draft: a.draft, userInput: a.draft.userInput, settings: defaultSettings() });
  const messages = prompt.messages.map(message => message.content).join('\n');
  return { messages, context: JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]) };
}

it('真实 World 请求清楚标识到期承接，只投影本轮仍待处理的入场', async () => {
  const a = issue194();
  const { messages, context } = await composedWorld(a);
  expect(context.EVENT_SCHEDULE.due).toEqual([expect.objectContaining({
    eventId: a.source.id, fixedEndAt: handoffDeadline, entryHandoff: {
      status: 'presented', channel: '电话', cue: '请核对样本清单', locationId: 'chongqing',
    },
  })]);
  expect(messages).toContain('子事件结案和主角入场处理是两个独立事项');
  expect(messages).toContain('即使源子事件选择 continuation.direction=end');
  expect(messages).toContain('不虚构邀请、选择、答复或后继来通过校验');
  expect(messages).toContain('当前协议没有“已知晓且无需回应”回执');
  const example = messages.match(/例如：资料核对阶段已完成[\s\S]*?```json\n([\s\S]*?)\n```/);
  expect(example).toBeTruthy();
  const parsedExample = parseWorld(JSON.stringify({ ...a.response, eventCommands: JSON.parse(example![1]) }), a.state, a.draft);
  expect(parsedExample.eventCommands).toHaveLength(2);
  a.draft.story!.variableGuide.push({ group: 'event', observedFact: '明确拒绝了核对请求', textEvidence: '主角明确拒绝了核对请求',
    eventInteraction: { eventId: a.source.id, entryId: a.source.protagonistEntry.id, action: 'declined' } });
  const handled = (await composedWorld(a)).context.EVENT_SCHEDULE;
  expect(handled.due).toHaveLength(1);
  expect(handled.due[0]).not.toHaveProperty('entryHandoff');
  const story = await composePrompt({ stage: 'story', mode: 'regular', state: a.state, draft: a.draft, userInput: a.draft.userInput, settings: defaultSettings() });
  expect(story.messages.some(message => message.content.includes('现有回执没有专门的“已知晓且无需回应”动作'))).toBe(true);
  const pending = (await composedWorld(issue194('pending'))).context.EVENT_SCHEDULE;
  expect(pending.due[0].entryHandoff).toMatchObject({ status: 'pending' });
});
