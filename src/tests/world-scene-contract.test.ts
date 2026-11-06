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
import { worldSources } from '../services/validation/worldEvidence';
import { projectTurn } from '../domain/turnProjection';
import { worldDraft, worldResult, worldState } from './fixtures/world';

import { hanhaiSceneContext as context, narrative, quotes } from './fixtures/hanhaiSceneContext';
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
  it('reproduces the old summary source_knowledge failure independently of the new anchor field', () => {
    const a = context();
    const { sceneRecord: _anchors, ...legacy } = a.evidence;
    void _anchors;
    a.response.eventCommands[0].evidence = JSON.stringify(legacy);
    expect(() => parse(a)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'source_knowledge' }) }));
  });
  it('reproduces the second actor_permission gate even with a valid legacy fact', () => {
    const a = context();
    a.response.eventCommands[0].evidence = JSON.stringify({ version: 1, kind: 'established', at: a.evidence.at, sources: ['story:current'], fact: quotes[0], rationale: '旧格式' });
    a.response.eventCommands[0].event.actorRefs = [a.response.eventCommands[0].event.actorRefs[0]];
    expect(() => parse(a)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'actor_permission' }) }));
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
  it.each(['title', 'backgroundText', 'goalText', 'resolutionText'] as const)('rejects invented action in %s despite genuine anchors', field => {
    const a = context(); Object.assign(a.response.eventCommands[0].event, { [field]: '吴杰涛已经付款并签字，林晚秋同意跑腿。' });
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it.each([
    ['denied fragment', '吴杰涛没有签字，也没有付款。', '签字，也没有付款。'],
    ['denied full sentence', '吴杰涛没有签字，也没有付款。', '吴杰涛没有签字，也没有付款。'],
    ['quoted claim', '周建斌说：“吴杰涛已经签字。”', '吴杰涛已经签字。'],
    ['rumor', '吴杰涛据说已经付款。', '吴杰涛据说已经付款。'],
    ['future', '吴杰涛准备明天付款。', '吴杰涛准备明天付款。'],
    ['fabricated', '', '吴杰涛已经付款。'],
  ])('rejects %s as an authoritative observation', (_name, extra, quote) => {
    const a = context(); a.draft.story!.narrative += `\n${extra}`; a.evidence.sceneRecord.anchors[0].quote = quote; evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('source_knowledge'));
  });
  it('does not accept a name on a roster as participant action', () => {
    const a = context(); const quote = '柜台名单写着吴杰涛的名字。'; a.draft.story!.narrative += `\n${quote}`;
    a.evidence.sceneRecord.anchors[0].quote = quote; evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('does not use a name elsewhere in the Story to supply a missing actor anchor', () => {
    const a = context(); a.evidence.sceneRecord.anchors.pop(); evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('rejects a fabricated stable participant identity', () => {
    const a = context(); a.response.eventCommands[0].event.actorRefs[0].id = 'unknown'; evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('does not grant UpdateNpc or RecordNpcMemory authority using a scene record', () => {
    const a = context(); a.response.worldCommands.push({type:'UpdateNpc',commandId:'unauthorized-update',npcId:'npc_chen_hao',expectedRevision:0,changes:{healthText:'受伤'},evidence:JSON.stringify(a.evidence)});
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('scene anchors cannot support a terminal outcome or fabricated verified facts', () => {
    const a = context(); a.response.eventCommands[0].event.status = 'resolved';
    Object.assign(a.response.eventCommands[0].event, {resolvedAt:a.evidence.at,resolutionText:quotes[0],resultKnowledge:{facts:['镜头客观存在暗病。'],reported:[],suspected:[]}});
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('missing permissioned story source is distinguishable from bad JSON', () => {
    const a = context(); a.evidence.sources = ['missing']; evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('source_missing'));
  });
  it('cannot redirect an anchor to private knowledge or add unknown evidence fields', () => {
    const a = context(); Object.assign(a.evidence.sceneRecord.anchors[0], {source:'memory:other:secret'}); evidenceInto(a);
    expect(() => parse(a)).toThrow(failure('source_format'));
  });
  it.each([
    ['unknown field', {anchors:[], approve:true}],
    ['empty anchors', {anchors:[]}],
    ['too many anchors', {anchors:Array.from({length:13},()=>({source:'story:current',quote:quotes[0],actorRefs:[{kind:'protagonist',id:'protagonist'}]}))}],
    ['oversized quote', {anchors:[{source:'story:current',quote:'字'.repeat(2001),actorRefs:[{kind:'protagonist',id:'protagonist'}]}]}],
    ['missing identity', {anchors:[{source:'story:current',quote:quotes[0],actorRefs:[]}]}],
  ])('strictly rejects %s in optional anchor metadata', (_name, sceneRecord) => {
    const a=context(); a.response.eventCommands[0].evidence=JSON.stringify({...a.evidence,sceneRecord});
    expect(()=>parse(a)).toThrow(failure('source_format'));
  });
  it('rejects duplicate source quotes without pretending multiple support',()=>{
    const a=context();a.evidence.sceneRecord.anchors.push(a.evidence.sceneRecord.anchors[0]);evidenceInto(a);
    expect(()=>parse(a)).toThrow(failure('source_format'));
  });
  it('optional anchors cannot turn planned evidence into an active scene record',()=>{
    const a=context();a.evidence.kind='planned';evidenceInto(a);
    expect(()=>parse(a)).toThrow(failure('actor_permission'));
  });
  it('cannot turn the synopsis into lens damage truth, knowledge or entry action', () => {
    const a = context(); a.evidence.fact = '镜头确有暗病，吴杰涛已同意付款。'; evidenceInto(a);
    const result = parse(a), after = projectTurn(a.state, a.draft, result.eventCommands);
    expect(after.npc).toEqual(a.state.npc); expect(after.protagonist).toEqual(a.state.protagonist); expect(after.economy).toEqual(a.state.economy);
    expect(JSON.stringify(after.events)).not.toContain('确有暗病');
    expect(JSON.stringify(worldSources(after, a.draft))).not.toContain(a.evidence.fact);
    a.response.eventCommands[0].event.continuation.entry.cue = a.evidence.fact;
    expect(() => parse(a)).toThrow(failure('actor_permission'));
  });
  it('an unreceived future arrangement still cannot grant player knowledge', () => {
    const state = worldState(), draft = worldDraft(), raw = { ...worldResult(), visibleHooks: [], eventCommands: [{type:'SaveEvent', commandId:'unknown-notice', evidence:JSON.stringify({version:1,kind:'planned',at:state.worldClock,sources:['npc:npc-a'],fact:'计划邀请主角。',rationale:'安排'}),event:{id:'notice',title:'邀请',status:'scheduled',startAt:'2026-10-19T08:00:00+08:00',estimatedEndAt:'2026-10-19T09:00:00+08:00',backgroundText:'新安排',goalText:'交流',actorRefs:[{kind:'npc',id:'npc-a'}],visibility:'known',impact:'minor',sourceTurnIds:[draft.turnId],linkedTaskIds:[],prerequisites:[],blockers:[]}}] };
    expect(() => parseWorld(JSON.stringify(raw),state,draft)).toThrow(failure('player_knowledge'));
  });
});

const repos: SaveRepository[] = [], stages: WorldStage[] = [];
afterEach(() => { stages.splice(0).forEach(stage => stage.dispose()); repos.splice(0).forEach(repo => repo.close()); vi.restoreAllMocks(); stageResponses.clear(); });
async function live() {
  const a = context(), repo = await SaveRepository.open('natural-scene-contract', new IDBFactory()); repos.push(repo);
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
    expect(String(init?.body)).toContain('sceneRecordFormat'); expect(String(init?.body)).toContain('sceneRecord');
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
    command.event.goalText = '吴杰涛已经签字付款。'; ready.world!.candidateRevision += 1;
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
  it('failed source validation keeps upstream candidates and raw output; explicit World retry succeeds', async () => {
    const a = await live(), valid = a.reply.text;
    a.response.eventCommands[0].evidence = JSON.stringify({...a.evidence,sceneRecord:{anchors:[{...a.evidence.sceneRecord.anchors[0],quote:'吴杰涛已经付款。'}]}});
    a.reply.text = `\`\`\`json\n${JSON.stringify(a.response)}\n\`\`\``;
    await expect(a.run()).rejects.toThrow(failure('source_knowledge'));
    expect(stageResponses.getSnapshot()[0]).toMatchObject({text:a.reply.text,status:'failed'});
    const failed = await a.repo.loadDraft('save-a'); expect(failed!.story).toEqual(a.draft.story); expect(failed!.variables).toEqual(a.draft.variables); expect(failed!.world).toBeUndefined();
    expect(await a.repo.load('save-a')).toEqual(a.state);
    a.reply.text = valid; const ready = await a.run(failed!); await a.repo.commitTurn(submission(ready,'')); expect(a.fetcher).toHaveBeenCalledTimes(2);
  });
});
