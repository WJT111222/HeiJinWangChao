import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { TurnDraftSchema } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseStory, parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { validateTurnCandidates } from '../services/validation/turnCommit';
import { eventEntryReasonNames } from '../services/validation/worldDiagnostics';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';
import { defaultSettings } from '../ui/settings/model';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { endStage, stageCommand } from './fixtures/eventStages';
import { handoffDeadline, issue194 } from './fixtures/issue194';
import { seedFixtureTurn, submission } from './fixtures/turn';
import { variableTextEnvelope } from './fixtures/variableReply';

function fourCommands() {
  const a=issue194();
  const source=a.state.events[a.source.id];
  source.entryIntent='notification';
  const decision={...structuredClone(a.source), id:'review-decision',title:'一项需要批准的申请',entryIntent:'decision' as const};
  decision.protagonistEntry.id='decision-entry';
  a.state.events[decision.id]=decision;
  const historic=endStage({...a.source,id:'review-historical',title:'历史资料归档',startAt:'2026-05-17T12:00:00+08:00',fixedEndAt:'2026-05-17T13:00:00+08:00'});
  delete historic.protagonistEntry;
  historic.sourceTurnIds=[a.state.journal[0].turnId];
  a.state.events[historic.id]=historic;
  const endDecision=endStage(decision);
  delete endDecision.protagonistEntry;
  const followup={...a.successor,id:'review-decision-followup',entryIntent:'decision' as const,predecessorEventIds:[decision.id]};
  a.response.eventCommands=[stageCommand(historic),stageCommand({...a.terminal,entryIntent:'notification'}),stageCommand(endDecision),stageCommand(followup)];
  a.response.taskCommands=[{ type:'SaveTask',commandId:'review-independent-task',evidence:'合成后台任务',
    task:{id:'review-task',status:'active',actorRef:{kind:'organization',id:'org-stage-a'},goal:'汇总已归档的资料',
      startAt:handoffDeadline,dueAt:'2026-05-17T15:00:00+08:00',prerequisites:[],blockers:[]} }];
  const settings=defaultSettings();
  settings.prompts.minNarrativeChars=1;
  settings.prompts.actionOptions=false;
  const evidence='主角听完工作通知，收到另一项审批请求但尚未作决定。';
  const guide=[{group:'event',observedFact:'实际收悉工作通知',textEvidence:evidence,
    eventInteraction:{eventId:source.id,entryId:a.source.protagonistEntry.id,action:'acknowledged'}}];
  a.draft.story=parseStory(`<thinking>收悉工作通知并保留审批请求。</thinking><正文>十分钟后，${evidence}</正文><短期记忆>已收悉通知，审批尚待决定。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`,'regular',settings);
  return {...a,state:GameStateSchema.parse(a.state),historic,decision,followup};
}

it('联合批次：收悉结案、终态复述、任务推进与待决承接，原子提交、重载和撤回',async()=>{
  const {state,draft,response,historic,decision,followup}=fourCommands();
  const factory=new IDBFactory(), name='joint-review';
  const repo=await SaveRepository.open(name,factory);
  let reopened: SaveRepository | undefined;
  try {
    const input={state,draft};
    await seedFixtureTurn(repo,input);
    const before=await repo.loadGame(state.saveId), selected=before.draft!;
    const projected=projectTurn(before.state,selected);
    expect(projected.events['handoff-source'].protagonistEntry?.status).toBe('acknowledged');
    expect(projected.events[decision.id].protagonistEntry?.status).toBe('presented');
    const raw=JSON.stringify(response);
    const normalized=parseWorld(raw,before.state,selected);
    expect(normalized.eventCommands.map(command=>command.commandId)).toEqual([
      'write:handoff-source','write:review-decision','write:review-decision-followup',
    ]);
    expect(worldNormalizationNotes.get(normalized)).toEqual(['eventCommands.0（SaveEvent）与已正式结案的事件完全相同，未重复写入。']);
    expect(parseWorld(JSON.stringify(normalized),before.state,selected)).toEqual(normalized);
    const ready=await repo.saveDraft(TurnDraftSchema.parse({...selected,draftRevision:selected.draftRevision+1,
      stageStatus:{...selected.stageStatus,world:'ready'},
      world:{storyRevision:selected.storyRevision,candidateRevision:1,requestRevision:0,
        basedOnVariableRevision:selected.variables!.candidateRevision,validation:'validated',result:normalized}}),selected.draftRevision);
    expect(()=>validateTurnCandidates(before.state,ready)).not.toThrow();
    expect(await repo.load(state.saveId)).toEqual(before.state);
    const saved=await repo.commitTurn(submission(ready,''));
    expect(saved.state.revision).toBe(before.state.revision+1);
    expect(saved.state.journal).toHaveLength(before.state.journal.length+1);
    expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);
    expect(saved.state.events['handoff-source']).toMatchObject({status:'resolved',resolvedAt:handoffDeadline,protagonistEntry:{status:'acknowledged'}});
    expect(Object.values(saved.state.events).filter(event=>event.predecessorEventIds?.includes('handoff-source'))).toEqual([]);
    expect(saved.state.events[historic.id]).toEqual(before.state.events[historic.id]);
    expect(saved.state.tasks['review-task']).toMatchObject({status:'active',goal:'汇总已归档的资料'});
    expect(saved.state.events[decision.id].protagonistEntry?.status).toBe('invalidated');
    expect(saved.state.events[followup.id]).toMatchObject({entryIntent:'decision',protagonistEntry:{status:'presented'}});
    expect(saved.state.appliedCommands).not.toContainEqual(expect.objectContaining({commandId:'write:review-historical'}));
    expect(saved.state.protagonist).toEqual(before.state.protagonist);
    expect(JSON.stringify(response)).toBe(raw);
    repo.close();
    reopened=await SaveRepository.open(name,factory);
    expect(await reopened.load(state.saveId)).toEqual(saved.state);
    const reverted=await reopened.undoTurn({saveId:state.saveId,expectedRevision:saved.state.revision,expectedDraft:saved.draft,operationId:'joint-review-undo'});
    expect(reverted.state).toMatchObject({events:before.state.events,tasks:before.state.tasks,worldClock:before.state.worldClock,journal:before.state.journal});
    expect(reverted.state.events[followup.id]).toBeUndefined();
    expect(reverted.state.tasks['review-task']).toBeUndefined();
    expect(reverted.input).toBe(selected.userInput);
  } finally { (reopened??repo).close(); }
});

it.each([
  {reason:'missing_successor',extraEchoes:0,fieldPath:'eventCommands.2.event.protagonistEntry',commandIndex:3},
  {reason:'mismatched_entry',extraEchoes:0,fieldPath:'eventCommands.3.event.entryIntent',commandIndex:4},
  {reason:'missing_successor',extraEchoes:2,fieldPath:'eventCommands.4.event.protagonistEntry',commandIndex:6},
] as const)('过滤历史复述后 $reason 仍使用原始位置（额外复述 $extraEchoes 条）', async ({reason,extraEchoes,fieldPath,commandIndex})=>{
  const {state,draft,response,historic}=fourCommands();
  if (extraEchoes) {
    const echoes=Array.from({length:extraEchoes},(_,index)=>{
      const event={...historic,id:`review-extra-${index}`,title:`另一条历史 ${index}`};
      state.events[event.id]=event;
      return stageCommand(event);
    });
    // Keep the legitimate notification between the first echo and the other echoes.
    response.eventCommands.splice(2,0,...echoes);
    response.worldCommands.push({type:'UpdateOrganization',commandId:'review-organization',organizationId:'org-stage-a',
      expectedRevision:state.revision,changes:{operatingStatus:'整理资料'},evidence:'合成后台举措'});
  }
  if (reason==='missing_successor') response.eventCommands.pop();
  else {
    const target=response.eventCommands.at(-1);
    if (target?.type!=='SaveEvent') throw Error('缺少待决承接测试夹具');
    target.event.entryIntent='notification';
  }
  const code=reason==='missing_successor' ? 'invalid_output' : 'permission';
  const details={worldRule:'event_entry',eventEntryReason:reason,commandType:'SaveEvent',fieldPath,commandIndex};
  const repo=await SaveRepository.open('joint-review-invalid',new IDBFactory());
  try {
    const input={state,draft};
    await seedFixtureTurn(repo,input);
    const before=await repo.loadGame(state.saveId), selected=before.draft!;
    let failure: unknown;
    try { parseWorld(JSON.stringify(response),before.state,selected); } catch (error) { failure=error; }
    expect(failure).toMatchObject({code,details});
    const log=runtimeLogEvent(1,'world','failed',failure);
    expect(log).toMatchObject({code,worldRule:'event_entry',commandType:'SaveEvent',fieldPath,commandIndex:commandIndex+1});
    expect(log.message).toContain(eventEntryReasonNames[reason]);
    expect(JSON.stringify(log)).not.toMatch(/review-|请核对样本清单/);
    expect(await repo.loadGame(state.saveId)).toEqual(before);

    // Even a structurally saved candidate must pass the same check at the transaction boundary.
    const ready=await repo.saveDraft(TurnDraftSchema.parse({...selected,draftRevision:selected.draftRevision+1,
      stageStatus:{...selected.stageStatus,world:'ready'},
      world:{storyRevision:selected.storyRevision,candidateRevision:1,requestRevision:0,
        basedOnVariableRevision:selected.variables!.candidateRevision,validation:'validated',result:response}}),selected.draftRevision);
    await expect(repo.commitTurn(submission(ready,''))).rejects.toMatchObject({code,details});
    expect(await repo.loadGame(state.saveId)).toEqual({...before,draft:ready});
  } finally { repo.close(); }
});

it('已结案的历史记录若仍带开放入场，原样复述也不能跳过承接规则',()=>{
  const {state,draft,response,historic,decision}=fourCommands();
  historic.protagonistEntry=structuredClone(decision.protagonistEntry);
  historic.protagonistEntry.queuedAt='2026-05-17T12:30:00+08:00';
  state.events[historic.id].protagonistEntry=historic.protagonistEntry;
  const historical=GameStateSchema.parse(state);
  expect(()=>parseWorld(JSON.stringify(response),historical,draft)).toThrow(expect.objectContaining({
    details:expect.objectContaining({worldRule:'event_entry',eventEntryReason:'missing_successor',commandIndex:1}),
  }));
});

it('本轮 Variables 现场结束的活动事件即使与投影完全一致，也不能冒充正式终态复述',async()=>{
  const a=issue194();
  const early='2026-05-17T13:55:00+08:00';
  a.draft.story!.narrative='五分钟后，主角接听并实际核对完成了事项，随后结束参与。';
  a.draft.story!.variableGuide=[{group:'event',observedFact:'现场结束事项',textEvidence:a.draft.story!.narrative,
    eventInteraction:{eventId:a.source.id,entryId:a.source.protagonistEntry.id,action:'left'}}];
  const text=variableTextEnvelope(`<命令>set worldClock = "${early}"
set events[handoff-source].sceneState = {"status":"resolved","resolvedAt":"${early}","outcome":"changed","resolutionText":"主角核对后实际结束现场事项。"}</命令>`);
  a.draft.variables!.result=await parseTextVariables(text,a.state,a.draft);
  const projected=projectTurn(a.state,a.draft);
  expect(projected.events[a.source.id].status).toBe('resolved');
  expect(a.state.events[a.source.id].status).toBe('active');
  expect(()=>parseWorld(JSON.stringify({...a.response,eventCommands:[stageCommand(projected.events[a.source.id])]}),a.state,a.draft))
    .toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'event_transition'})}));
});
