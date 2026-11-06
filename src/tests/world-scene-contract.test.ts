import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { parseWorld } from '../services/validation/aiOutputs';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultSettings } from '../ui/settings/model';
import { submission } from './fixtures/turn';
import { worldDraft, worldResult, worldState } from './fixtures/world';

import { hanhaiSceneContext as context, narrative } from './fixtures/hanhaiSceneContext';
const parse = (a: ReturnType<typeof context>) => parseWorld(JSON.stringify(a.response), a.state, a.draft);
describe('World JSON wrapper contract', () => {
  it.each(['json fence', 'opening fence', 'CRLF fence'])('accepts one %s without changing business validation', mode => {
    const state = worldState(), draft = worldDraft(), raw = JSON.stringify({ ...worldResult(), visibleHooks: [] });
    const wrapped = mode === 'json fence' ? `\n\`\`\`json\n${raw}\n\`\`\`\n` : mode === 'opening fence' ? `\`\`\`json\n${raw}` : ` \r\n\`\`\`json\r\n${raw}\r\n\`\`\`\r\n`;
    expect(parseWorld(wrapped, state, draft)).toEqual(parseWorld(raw, state, draft));
  });
});
describe('World natural scene source contract', () => {
  it('records separate affirmative paragraphs without a verbatim summary/title/goal', () => {
    const a = context(), before = structuredClone(a.state);
    expect(narrative).not.toContain(a.evidence.fact);
    for (const field of ['title', 'backgroundText', 'goalText'] as const) expect(narrative).not.toContain(a.response.eventCommands[0].event[field]);
    expect(parse(a).eventCommands[0]).toMatchObject({ type: 'SaveEvent', event: { status: 'active' } });
    expect(a.state).toEqual(before);
  });
});

const failure = (worldRule: string) => expect.objectContaining({ details: expect.objectContaining({ worldRule }) });
function evidenceInto(a: ReturnType<typeof context>) { a.response.eventCommands[0].evidence = JSON.stringify(a.evidence); }
describe('whole JSON and unchanged Schema boundary', () => {
  const raw = JSON.stringify({ ...worldResult(), visibleHooks: [] });
  it.each([
    ['prefix', `解释：${raw}`], ['suffix', `${raw}完毕`],
    ['two objects', `${raw} ${raw}`], ['two blocks', `\`\`\`json\n${raw}\n\`\`\`\n\`\`\`json\n${raw}\n\`\`\``],
    ['text outside fence', `\`\`\`json\n${raw}\n\`\`\`\n解释`],
    ['truncated', `\`\`\`json\n${raw.slice(0, -5)}\n\`\`\``],
    ['trailing comma', `\`\`\`json\n${raw.slice(0, -1)},}\n\`\`\``],
    ['other language', `\`\`\`javascript\n${raw}\n\`\`\``],
  ])('rejects %s without partial extraction', (_name, text) => {
    expect(() => parseWorld(text, worldState(), worldDraft())).toThrow(failure('json'));
  });
  it.each(['{}', '[]', '{"worldCommands":[{"type":"GiveAllMoney"}]}'])('a valid fenced JSON value still needs the original Schema: %s', text => {
    expect(() => parseWorld(`\`\`\`json\n${text}\n\`\`\``, worldState(), worldDraft())).toThrow(failure('schema'));
  });
  it('preserves fence text inside legal JSON strings rather than stripping it', () => {
    const result = { ...worldResult(), visibleHooks: [], unresolved: ['文本中提及```json与```，并非外层包装。'] };
    expect(parseWorld(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``, worldState(), worldDraft())).toEqual(result);
  });
});
describe('anchored scene security and diagnostics', () => {
  it('rejects a fabricated stable participant identity', () => {
    const a = context(); a.response.eventCommands[0].event.actorRefs[0].id = 'unknown'; evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('does not grant UpdateNpc or RecordNpcMemory authority using a scene record', () => {
    const a = context(); a.response.worldCommands.push({type:'UpdateNpc',commandId:'unauthorized-update',npcId:'npc_chen_hao',expectedRevision:0,changes:{healthText:'受伤'},evidence:JSON.stringify(a.evidence)});
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
});

const repos: SaveRepository[] = [], stages: WorldStage[] = [];
afterEach(() => { stages.splice(0).forEach(stage => stage.dispose()); repos.splice(0).forEach(repo => repo.close()); vi.restoreAllMocks(); stageResponses.clear(); });
async function live(a = context()) {
  const repo = await SaveRepository.open('natural-scene-contract', new IDBFactory()); repos.push(repo);
  await repo.create(a.state);
  const initial = createTurnDraft(a.state.saveId, a.state.revision, a.draft.turnId, 'opening', '');
  await repo.saveDraft(initial, null);
  const selected = await repo.saveDraft(rerollStory(initial, a.draft.story!), initial.draftRevision);
  a.draft = await repo.saveDraft(TurnDraftSchema.parse({...selected,draftRevision:selected.draftRevision+1,variables:a.draft.variables,stageStatus:{...selected.stageStatus,variables:'ready'}}), selected.draftRevision);
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'world'; config.channels = [channel]; config.routes.story = {channelId:channel.id,modelId:'world'};
  const data = new Map<string,string>(), storage = {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  const vault = new CredentialVault(storage,storage); vault.set(channel.id,'natural-scene-mock-only');
  const reply = {text:`\`\`\`json\n${JSON.stringify(a.response,null,2)}\n\`\`\``};
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    // Real Composer and request, not an isolated helper/schema test.
    expect(String(init?.body)).toContain('COMMAND_CATALOG'); expect(String(init?.body)).not.toContain('WORLD_EVIDENCE_V1'); expect(String(init?.body)).not.toContain('sceneRecordFormat');
    return Response.json({choices:[{message:{content:reply.text},finish_reason:'stop'}]});
  });
  const stage = new WorldStage(repo,new AiClient(fetcher)); stages.push(stage);
  const run = (draft = a.draft) => stage.generate({draft,config,vault,settings:defaultSettings()});
  return {...a,repo,run,reply,fetcher};
}
describe('real WorldStage/Runtime -> candidate -> Commit -> reload', () => {
  it('preserves raw fences, stores only validated candidates and commits once', async () => {
    const a = await live(), ready = await a.run();
    expect(await a.repo.load('save-a')).toEqual(a.state);
    expect(stageResponses.getSnapshot()[0]).toMatchObject({text:a.reply.text,status:'validated'});
    const saved = await a.repo.commitTurn(submission(ready,''));
    expect(saved.state.events.event_hanhai_lens_extortion.status).toBe('active');
    expect(saved.state.npc).toEqual(a.state.npc); expect(saved.state.economy).toEqual(a.state.economy);
    expect(await a.repo.load('save-a')).toEqual(saved.state); expect((await a.repo.commitTurn(submission(ready,''))).replayed).toBe(true);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects forged persisted candidates on commit revalidation', async () => {
    const a = await live(), ready = await a.run(), command = ready.world!.result.eventCommands[0];
    if (command.type !== 'SaveEvent') throw Error('fixture');
    command.event.actorRefs[0].id = 'nonexistent-actor'; ready.world!.candidateRevision += 1;
    const stored = await a.repo.loadDraft('save-a');
    const forged = await a.repo.saveDraft({...ready,draftRevision:ready.draftRevision+1},stored!.draftRevision);
    await expect(a.repo.commitTurn(submission(forged,''))).rejects.toThrow();
    expect(await a.repo.load('save-a')).toEqual(a.state);
  });
  it('rolls back journal/events/clock together and retries persisted candidates without another model call', async () => {
    const a = await live(), ready = await a.run(), before = await a.repo.loadGame('save-a'), put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw Error('mock rollback');return put.apply(this,args);});
    await expect(a.repo.commitTurn(submission(ready,''))).rejects.toThrow(); spy.mockRestore();
    expect(await a.repo.loadGame('save-a')).toEqual(before);
    const persisted = await a.repo.loadDraft('save-a');
    const saved = await a.repo.commitTurn(submission(persisted!,''));
    expect(saved.state.journal).toHaveLength(1); expect(a.fetcher).toHaveBeenCalledTimes(1);
  });
  it('failed reference validation keeps upstream candidates and raw output; explicit World retry succeeds', async () => {
    const a = await live(), valid = a.reply.text;
    a.response.eventCommands[0].event.actorRefs[0].id = 'nonexistent-actor';
    a.reply.text = `\`\`\`json\n${JSON.stringify(a.response)}\n\`\`\``;
    await expect(a.run()).rejects.toThrow(failure('actor_permission'));
    expect(stageResponses.getSnapshot()[0]).toMatchObject({text:a.reply.text,status:'failed'});
    const failed = await a.repo.loadDraft('save-a'); expect(failed!.story).toEqual(a.draft.story); expect(failed!.variables).toEqual(a.draft.variables); expect(failed!.world).toBeUndefined();
    expect(await a.repo.load('save-a')).toEqual(a.state);
    a.reply.text = valid; const ready = await a.run(failed!); await a.repo.commitTurn(submission(ready,'')); expect(a.fetcher).toHaveBeenCalledTimes(2);
  });
});


function syncAnchors(a: ReturnType<typeof context>) {
  a.response.eventCommands[0].event.backgroundText = `现场依据：\n${a.evidence.sceneRecord.anchors.map(anchor => anchor.quote).join('\n')}`;
  evidenceInto(a);
}
function labelledContext(standalone: boolean, includeLabel: boolean) {
  const a=context();
  if (standalone) a.draft.story!.narrative=a.draft.story!.narrative.replaceAll('【旁白】','【旁白】\n');
  if (includeLabel) for (const anchor of a.evidence.sceneRecord.anchors) anchor.quote=`【旁白】${standalone?'\n':''}${anchor.quote}`;
  syncAnchors(a);return a;
}
describe('R1 formal narration labels through parseWorld and persistence',()=>{
  it.each([[false,false],[false,true],[true,false],[true,true]])('inline/standalone=%s, retained label=%s: full source and stable subjects are compatible',async(standalone,includeLabel)=>{
    const a=labelledContext(standalone,includeLabel),before=structuredClone(a.state);
    expect(()=>parse(a)).not.toThrow();
    const runtime=await live(a),ready=await runtime.run();
    expect(stageResponses.getSnapshot()[0]).toMatchObject({text:runtime.reply.text,status:'validated'});
    expect(await runtime.repo.load('save-a')).toEqual(before);
    const saved=await runtime.repo.commitTurn(submission(ready,''));
    expect(saved.state.journal[0].story.narrative).toBe(a.draft.story!.narrative);
    expect(saved.state.npc).toEqual(before.npc);expect(saved.state.economy).toEqual(before.economy);
    expect(saved.state.events.event_hanhai_lens_extortion.backgroundText).toBe(a.response.eventCommands[0].event.backgroundText);
    expect(await runtime.repo.load('save-a')).toEqual(saved.state);
    expect((await runtime.repo.commitTurn(submission(ready,''))).replayed).toBe(true);expect(runtime.fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves CRLF and treats legacy evidence as opaque text', () => {
    const a = labelledContext(true, true);
    a.draft.story!.narrative = a.draft.story!.narrative.replaceAll('\n', '\r\n');
    for (const anchor of a.evidence.sceneRecord.anchors) anchor.quote = anchor.quote.replaceAll('\n', '\r\n');
    syncAnchors(a); expect(() => parse(a)).not.toThrow();
    a.evidence.sceneRecord.anchors[0].quote = a.evidence.sceneRecord.anchors[0].quote.replace('\r\n', ''); syncAnchors(a);
    expect(() => parse(a)).not.toThrow();
  });
});
