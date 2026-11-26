import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { issue194 } from './fixtures/issue194';
import { SaveRepository } from '../services/storage/saveRepository';
import { authorizeLegacyNotificationRecovery, legacyNotificationRecoveryOptions } from '../domain/legacyNotificationRecovery';
import { validateStoryEventInteractions } from '../domain/events/interactions';
import { configureTurnStages, rerollStory } from '../domain/drafts';
import { submission } from './fixtures/turn';
import { projectTurn } from '../domain/turnProjection';
import { parseWorld } from '../services/validation/aiOutputs';

function fixture() {
  const a = issue194();
  a.draft.stageStatus.world = 'failed';
  a.draft.failures.push({stage:'world',attempt:1,storyRevision:a.draft.storyRevision,errorCode:'invalid_output',retryable:false});
  const selection = {eventId:a.source.id,entryId:a.source.protagonistEntry.id,notificationOnly:true as const,finishReading:true as const};
  const text = '主角听完三家分店的工作汇报，只收悉结果。';
  const story = {...a.draft.story!,narrative:text,variableGuide:[{group:'event' as const,observedFact:text,textEvidence:text,
    eventInteraction:{eventId:selection.eventId,entryId:selection.entryId,action:'acknowledged' as const}}]};
  return {...a,selection,story};
}

it('旧 world 失败草稿经明确确认重做正文，只能在结算投影收悉所选入场',async()=>{
  const a = fixture(),repo = await SaveRepository.open('legacy-entry',new IDBFactory());
  try {
    await repo.importBackup(a,(await repo.compareBackup(a)).confirmation);
    const before = await repo.loadGame(a.state.saveId);
    expect(()=>parseWorld(JSON.stringify(a.response),before.state,before.draft!)).toThrow(expect.objectContaining({
      details:expect.objectContaining({worldRule:'event_entry'}),
    }));
    const draft = await repo.saveRecoveredStory(before.draft!,a.story,a.selection,undefined,await repo.prepareWorldview(before.draft!,false));
    expect(draft.storyRevision).toBe(before.draft!.storyRevision+1);
    expect(draft.variables).toBeUndefined();
    expect(draft.world).toBeUndefined();
    expect(draft.userInput).toBe(before.draft!.userInput);
    for (const config of [{useVariableStage:false,useWorldStage:true},{useVariableStage:true,useWorldStage:false}]) {
      expect(()=>configureTurnStages(draft,config)).toThrow(expect.objectContaining({code:'LEGACY_RECOVERY_STAGES'}));
    }
    expect(await repo.load(a.state.saveId)).toEqual(before.state);
    const ready = {...draft,variables:{...before.draft!.variables!,storyRevision:draft.storyRevision},
      stageStatus:{...draft.stageStatus,variables:'ready' as const}};
    const result = parseWorld(JSON.stringify(a.response),before.state,ready);
    expect(parseWorld(JSON.stringify(result),before.state,ready)).toEqual(result);
    const projected = projectTurn(before.state,ready,result.eventCommands);
    expect(projected.events[a.source.id]).toMatchObject({status:'resolved',protagonistEntry:{status:'acknowledged'}});
    expect(projected.events[a.source.id].entryIntent).toBeUndefined();
    const variables = await repo.saveDraft({...ready,draftRevision:draft.draftRevision+1},draft.draftRevision);
    const complete = await repo.saveDraft({...variables,draftRevision:variables.draftRevision+1,
      world:{storyRevision:draft.storyRevision,requestRevision:0,candidateRevision:1,validation:'validated',
        basedOnVariableRevision:variables.variables!.candidateRevision,result},
      stageStatus:{...variables.stageStatus,world:'ready'},
    },variables.draftRevision);
    const [unsettled] = await repo.exportBackup([a.state.saveId]);
    expect(unsettled.draft?.legacyNotificationRecovery).toEqual(complete.legacyNotificationRecovery);
    const copy = await SaveRepository.open('legacy-entry-copy',new IDBFactory());
    try {
      await copy.importBackup(unsettled,(await copy.compareBackup(unsettled)).confirmation);
      expect(await copy.loadDraft(a.state.saveId)).toBeUndefined();
      expect(await copy.load(a.state.saveId)).toEqual(before.state);
    } finally { copy.close(); }
    const committed = await repo.commitTurn(submission(complete,''));
    expect((await repo.commitTurn(submission(complete,''))).replayed).toBe(true);
    expect(committed.state.events[a.source.id].protagonistEntry).toMatchObject({
      status:'acknowledged', recoverySource:'player-confirmed-legacy-notification',
    });
    expect(committed.state).toMatchObject({npc:before.state.npc,organizations:before.state.organizations,
      tasks:before.state.tasks,economy:before.state.economy,protagonist:before.state.protagonist});
    const [backup] = await repo.exportBackup([a.state.saveId]);
    const committedCopy = await SaveRepository.open('committed-legacy-copy',new IDBFactory());
    try {
      await committedCopy.importBackup(backup,(await committedCopy.compareBackup(backup)).confirmation);
      expect(await committedCopy.load(a.state.saveId)).toEqual(committed.state);
    } finally { committedCopy.close(); }
    const mark = await repo.history.create(a.state.saveId,'旧通知收悉后');
    const reverted = await repo.undoTurn({saveId:a.state.saveId,expectedRevision:committed.state.revision,
      expectedDraft:committed.draft,operationId:'undo-legacy-notice'});
    expect(reverted.state.events).toEqual(before.state.events);
    expect((await repo.history.preview(a.state.saveId,{kind:'manual',id:mark.id})).state.events).toEqual(committed.state.events);
  } finally { repo.close(); }
});

it('旧待决入场不能凭普通模型回执关闭，明确拒绝仍按原协议',()=>{
  const a = fixture();
  a.state.events[a.source.id].protagonistEntry!.cue = '请问你是否批准追加投资？';
  expect(legacyNotificationRecoveryOptions(a.state,a.draft)).toHaveLength(1);
  expect(()=>validateStoryEventInteractions(a.state,a.story)).toThrow(expect.objectContaining({code:'EVENT_ENTRY'}));
  const rejected: typeof a.draft.story = structuredClone(a.story);
  rejected.variableGuide[0].eventInteraction!.action = 'declined';
  expect(()=>validateStoryEventInteractions(a.state,rejected)).not.toThrow();
  expect(a.state.events[a.source.id].protagonistEntry?.status).toBe('presented');
});

it('只能用当前正式版本与当前旧入场的明确选择，普通保存不能创建授权',async()=>{
  const a = fixture(), repo = await SaveRepository.open('legacy-notice-permission',new IDBFactory());
  try {
    await repo.importBackup(a,(await repo.compareBackup(a)).confirmation);
    const before = await repo.loadGame(a.state.saveId), draft = before.draft!;
    const proof = authorizeLegacyNotificationRecovery(before.state,draft,a.selection);
    const ordinaryReplacement = rerollStory(draft,a.story);
    expect(ordinaryReplacement).not.toHaveProperty('legacyNotificationRecovery');
    const forged = {...ordinaryReplacement,legacyNotificationRecovery:proof};
    await expect(repo.saveDraft(forged,draft.draftRevision,undefined,draft)).rejects.toMatchObject({code:'DRAFT_CONTEXT'});
    await expect(repo.saveRecoveredStory(draft,a.story,{...a.selection,entryId:'old-entry'})).rejects.toMatchObject({code:'DRAFT_CONFLICT'});
    await expect(repo.saveRecoveredStory(draft,a.story,{...a.selection,notificationOnly:false as never})).rejects.toThrow();
    const noReceipt = {...a.story,variableGuide:[]};
    await expect(repo.saveRecoveredStory(draft,noReceipt,a.selection)).rejects.toMatchObject({code:'LEGACY_RECOVERY_RECEIPT'});
    const oversized = structuredClone(a.story);
    oversized.variableGuide[0].textEvidence = '收'.repeat(8001);
    await expect(repo.saveRecoveredStory(draft,oversized,a.selection)).rejects.toMatchObject({code:'LEGACY_RECOVERY_RECEIPT'});
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>) {
      if(this.name==='drafts') throw Error('synthetic recovery write failure');
      return put.apply(this,args);
    });
    try { await expect(repo.saveRecoveredStory(draft,a.story,a.selection)).rejects.toThrow(); }
    finally { failure.mockRestore(); }
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
    const concurrent = await Promise.allSettled([
      repo.saveRecoveredStory(draft,a.story,a.selection),repo.saveRecoveredStory(draft,a.story,a.selection),
    ]);
    expect(concurrent.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(concurrent).toContainEqual(expect.objectContaining({status:'rejected',reason:expect.objectContaining({code:'DRAFT_CONFLICT'})}));
    expect(await repo.load(a.state.saveId)).toEqual(before.state);
  } finally { repo.close(); }
});
