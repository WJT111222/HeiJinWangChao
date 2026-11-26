import { expect, it, vi } from 'vitest';
import { issue194, handoffDeadline } from './fixtures/issue194';
import { stageCommand } from './fixtures/eventStages';
import { parseStory, parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { GameStateSchema } from '../domain/state';
import { commitCommands } from '../domain/commands';
import { validateStoryEventInteractions } from '../domain/events/interactions';
import { validateStageSettlement } from '../domain/events/stages';
import { validateSceneEventUpdate } from '../domain/events/scenePermission';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { seedFixtureTurn, submission } from './fixtures/turn';
import { projectTurn } from '../domain/turnProjection';
import { defaultSettings } from '../ui/settings/model';

const notificationEvidence = '主角听完了后台谈判结果的语音汇报，已收悉。';
function withAcknowledgment(status: 'presented' | 'pending' = 'presented') {
  const a = issue194(status);
  const source = a.state.events[a.source.id];
  if (source.continuation?.direction !== 'protagonist') throw Error('Missing notification plan');
  source.continuation.entry.cue = '汇报谈判进度，无需回应。';
  source.protagonistEntry!.cue = source.continuation.entry.cue;
  a.state.events[a.source.id].entryIntent = 'notification';
  const terminal = { ...a.terminal, entryIntent: 'notification' as const };
  a.response.eventCommands = [stageCommand(terminal)];
  const guide = [{ group: 'event', observedFact: '已收悉工作汇报', textEvidence: notificationEvidence,
    eventInteraction: { eventId: a.source.id, entryId: a.source.protagonistEntry.id, action: 'acknowledged' },
  }];
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 1;
  settings.prompts.actionOptions = false;
  a.draft.story = parseStory(`<thinking>按玩家行动查看汇报。</thinking><正文>${notificationEvidence}</正文><短期记忆>主角收悉工作汇报。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`, 'regular', settings);
  return { ...a, terminal };
}

it('计划标为纯通知，Story 收悉后通过固定时间结案，不需要创造后继', () => {
  const a = withAcknowledgment();
  const projected = projectTurn(a.state, a.draft);
  expect(projected.events[a.source.id]).toMatchObject({status:'active',protagonistEntry:{status:'acknowledged'}});
  const normalized = parseWorld(JSON.stringify(a.response), a.state, a.draft);
  expect(parseWorld(JSON.stringify(normalized), a.state, a.draft)).toEqual(normalized);
  const settled = projectTurn(a.state, a.draft, normalized.eventCommands);
  expect(settled.events[a.source.id]).toMatchObject({status:'resolved',resolvedAt:handoffDeadline,protagonistEntry:{status:'acknowledged'}});
  expect(Object.keys(settled.events)).toEqual(Object.keys(a.state.events));
  expect(settled.protagonist).toEqual(a.state.protagonist);
});

const validate = (a: ReturnType<typeof issue194>) => parseWorld(JSON.stringify(a.response), a.state, a.draft);
const clockText = '<thinking>只记录时间。</thinking><说明>程序处理回执。</说明><命令>set worldClock = "2026-05-17T14:00:00+08:00"</命令>';

it('在同一幕实际收到纯通知，pending 可以直接由 Story 收悉', async () => {
  const a = withAcknowledgment('pending');
  const result = await parseTextVariables(clockText, a.state, a.draft);
  expect(result.commands.map(command => command.type)).toEqual(['SetWorldClock']);
  expect(projectTurn(a.state,a.draft).events[a.source.id].protagonistEntry?.status).toBe('acknowledged');
  expect(validate(a).eventCommands).toHaveLength(1);
});

it('仅有正文文字、没有回执，Variables 不推断收悉，World 不丢弃已呈现的通知', async () => {
  const a = withAcknowledgment();
  a.draft.story!.variableGuide = [];
  await parseTextVariables(clockText, a.state, a.draft);
  expect(projectTurn(a.state,a.draft).events[a.source.id].protagonistEntry?.status).toBe('presented');
  expect(() => validate(a)).toThrow(expect.objectContaining({details:expect.objectContaining({eventEntryReason:'missing_successor'})}));
});

it.each(['unknown_event','wrong_entry','duplicate','closed','decision','legacy','blank_evidence','retrospective'] as const)(
  '拒绝非法收悉：%s', kind => {
    const a = withAcknowledgment(), guide = a.draft.story!.variableGuide[0], event = a.state.events[a.source.id];
    const receipt = guide.eventInteraction!;
    let storyRule = 'receipt_notification';
    if (kind === 'unknown_event') { receipt.eventId = 'absent-event'; storyRule = 'receipt_reference'; }
    if (kind === 'wrong_entry') { receipt.entryId = 'stale-entry'; storyRule = 'receipt_reference'; }
    if (kind === 'duplicate') { a.draft.story!.variableGuide.push(structuredClone(guide)); storyRule = 'receipt_duplicate'; }
    if (kind === 'closed') { event.protagonistEntry!.status = 'acknowledged'; storyRule = 'receipt_closed'; }
    if (kind === 'decision') event.entryIntent = 'decision';
    if (kind === 'legacy') delete event.entryIntent;
    if (kind === 'blank_evidence') { guide.textEvidence = '  '; storyRule = 'receipt_evidence_empty'; }
    if (kind === 'retrospective') a.draft.story!.variableGuide.push({group:'time',subjectHint:'time:retrospective',observedFact:'阅读过去记录'});
    expect(() => validateStoryEventInteractions(a.state,a.draft.story!)).toThrow(
      expect.objectContaining({ diagnostic: expect.objectContaining({storyRule}) }));
  },
);

it('待决请求读到仍未决定；保持原类型承接、明确拒绝时按原流程结束', () => {
  const a = withAcknowledgment();
  a.state.events[a.source.id].entryIntent = 'decision';
  a.response.eventCommands = [stageCommand({...a.terminal,entryIntent:'decision'})];
  a.draft.story!.variableGuide = [];
  expect(() => validate(a)).toThrow(expect.objectContaining({details:expect.objectContaining({eventEntryReason:'missing_successor'})}));
  a.response.eventCommands.push(stageCommand({...a.successor,entryIntent:'notification'}));
  expect(() => validate(a)).toThrow(expect.objectContaining({details:expect.objectContaining({
    eventEntryReason:'mismatched_entry',fieldPath:'eventCommands.1.event.entryIntent',
  })}));
  a.response.eventCommands[1] = stageCommand({...a.successor,entryIntent:'decision',continuation:{
    ...a.successor.continuation,entry:{...a.successor.continuation.entry,cue:a.state.events[a.source.id].protagonistEntry!.cue},
  }});
  const retained = projectTurn(a.state,a.draft,validate(a).eventCommands);
  expect(retained.events[a.successor.id]).toMatchObject({entryIntent:'decision',protagonistEntry:{status:'presented'}});
  expect(retained.protagonist).toEqual(a.state.protagonist);
  const forged = structuredClone(retained);
  forged.events[a.successor.id].entryIntent = 'notification';
  expect(() => validateStageSettlement(projectTurn(a.state,a.draft),forged,a.draft.turnId))
    .toThrow(expect.objectContaining({code:'STAGE_ENTRY'}));
  a.draft.story!.narrative = '主角听取请求并明确拒绝接受。';
  a.draft.story!.variableGuide.push({group:'event',observedFact:'明确拒绝',textEvidence:'主角明确拒绝接受请求',
    eventInteraction:{eventId:a.source.id,entryId:a.source.protagonistEntry.id,action:'declined'}});
  a.response.eventCommands.pop();
  const declined = projectTurn(a.state,a.draft,validate(a).eventCommands);
  expect(declined.events[a.source.id].protagonistEntry?.status).toBe('declined');
  expect(declined.events[a.successor.id]).toBeUndefined();
});

it('未知后台工作正常结案；计划可新增但不能追溯分类旧事件', () => {
  const a = issue194(), source = a.state.events[a.source.id];
  delete source.protagonistEntry;
  delete source.continuation;
  const result = projectTurn(a.state,a.draft,validate(a).eventCommands);
  expect(result.events[a.source.id]).toMatchObject({status:'resolved',visibility:'hidden'});
  expect(result.events[a.source.id].protagonistKnowledge).toBeUndefined();
  const planned = {...a.successor,predecessorEventIds:[],entryIntent:'notification' as const};
  a.response.eventCommands.push(stageCommand(planned));
  expect(validate(a).eventCommands).toHaveLength(2);
  a.response.eventCommands[0] = stageCommand({...a.terminal,entryIntent:'notification'});
  expect(() => validate(a)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'event_immutable'})}));
  expect(() => commitCommands(a.state,a.draft.turnId,a.state.revision,[stageCommand({...source,entryIntent:'decision'})]))
    .toThrow(expect.objectContaining({code:'EVENT_CONTEXT'}));
});

it('World 与独立 SaveEvent 均无法伪造收悉状态，缺类型的收悉存档不通过严格校验', () => {
  const a = withAcknowledgment(), forged = projectTurn(a.state,a.draft).events[a.source.id];
  expect(GameStateSchema.safeParse({...a.state,events:{...a.state.events,[forged.id]:{...forged,entryIntent:undefined}}}).success).toBe(false);
  a.draft.story!.variableGuide = [];
  a.response.eventCommands = [stageCommand({...a.terminal,protagonistEntry:forged.protagonistEntry}),stageCommand({...a.successor,entryIntent:'notification'})];
  const successor = a.response.eventCommands[1];
  if (successor.type !== 'SaveEvent') throw Error('missing successor');
  const plan = successor.event;
  if (plan.continuation?.direction !== 'protagonist') throw Error('missing plan');
  plan.continuation.entry.cue = a.state.events[a.source.id].protagonistEntry!.cue;
  expect(() => validate(a)).toThrow(expect.objectContaining({details:expect.objectContaining({eventEntryReason:'forged_entry'})}));
  expect(() => commitCommands(a.state,a.draft.turnId,a.state.revision,[stageCommand(forged)]))
    .toThrow(expect.objectContaining({code:'EVENT_ENTRY'}));
  expect(a.state.events[a.source.id].protagonistEntry?.status).toBe('presented');
});

it('收悉不能授予活动改写、现场权限或提前结案', async () => {
  const a = withAcknowledgment(), initial = structuredClone(a.state);
  const projected = projectTurn(a.state,a.draft);
  expect(() => validateSceneEventUpdate(a.state,projected,{...a.state.events[a.source.id],sourceTurnIds:[...a.source.sourceTurnIds,a.draft.turnId]},a.draft.turnId,a.draft.story))
    .toThrow(expect.objectContaining({code:'SCENE_PERMISSION'}));
  for (const change of [{status:'blocked'}, {status:'resolved',resolvedAt:'2026-05-17T13:55:00+08:00',resolutionText:'提前结束',outcome:'success'}]) {
    const text = `<thinking>尝试越权改写。</thinking><说明>无现场权限。</说明><命令>set worldClock = "2026-05-17T14:00:00+08:00"
set events[handoff-source].sceneState = ${JSON.stringify(change)}</命令>`;
    await expect(parseTextVariables(text,a.state,a.draft)).rejects.toThrow();
  }
  expect(a.state).toEqual(initial);
});

it('正式事务失败不落盘，再提交只发生一次，备份及返读保留收悉', async () => {
  const a = withAcknowledgment(), repo = await SaveRepository.open('acknowledged-entry',new IDBFactory());
  try {
    const input = {state:a.state,draft:a.draft};
    await seedFixtureTurn(repo,input);
    a.draft = (await repo.loadGame(a.state.saveId)).draft!;
    a.state = await repo.load(a.state.saveId);
    const result = validate(a);
    const draft = await repo.saveDraft({...a.draft,draftRevision:a.draft.draftRevision+1,
      stageStatus:{...a.draft.stageStatus,world:'ready'},
      world:{storyRevision:a.draft.storyRevision,candidateRevision:1,requestRevision:0,
        basedOnVariableRevision:a.draft.variables!.candidateRevision,validation:'validated',result},
    },a.draft.draftRevision);
    const before = await repo.loadGame(a.state.saveId);
    const put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){
      if(this.name==='saves')throw Error('mock transaction failure');
      return put.apply(this,args);
    });
    try { await expect(repo.commitTurn(submission(draft,''))).rejects.toThrow(); }
    finally { fault.mockRestore(); }
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
    const saved = await repo.commitTurn(submission(draft,''));
    expect(saved.state.revision).toBe(before.state.revision+1);
    expect((await repo.commitTurn(submission(draft,''))).replayed).toBe(true);
    expect((await repo.loadGame(a.state.saveId)).state).toEqual(saved.state);
    const [backup] = await repo.exportBackup([a.state.saveId]);
    expect(backup.state).toEqual(saved.state);
    const copy = await SaveRepository.open('acknowledged-backup',new IDBFactory());
    try {
      await copy.importBackup(backup,(await copy.compareBackup(backup)).confirmation);
      expect((await copy.load(a.state.saveId)).events[a.source.id]).toEqual(saved.state.events[a.source.id]);
    } finally { copy.close(); }
    const bookmark = await repo.history.create(a.state.saveId,'收悉后');
    const restored = await repo.undoTurn({saveId:a.state.saveId,expectedRevision:saved.state.revision,expectedDraft:saved.draft,operationId:'ack-undo'});
    expect(restored.state.events).toEqual(before.state.events);
    const historical = await repo.history.preview(a.state.saveId,{kind:'manual',id:bookmark.id});
    expect(historical.state.events[a.source.id]).toEqual(saved.state.events[a.source.id]);
  } finally { repo.close(); }
});
