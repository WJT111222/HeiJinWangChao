import { describe, expect, it } from 'vitest';
import { createTurnDraft, rerollStory, startStageAttempt, TurnDraftSchema } from '../domain/drafts';
import { historyCatalogReason } from '../prompts/historyCatalog';
import { composePrompt } from '../prompts/composer';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { defaultAiConfig, AiConfigSchema } from '../services/ai/configuration';
import { parseEntities, parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { validateTurnCandidates } from '../services/validation/turnCommit';
import { variableTextEnvelope } from './fixtures/variableReply';
import { event, organizations, task } from './fixtures/game';
import { historyState } from './fixtures/history';
import { actionTime, projectedTime, worldState, worldResult, npcUpdate } from './fixtures/world';

function turn() {
  const prior = historyState(1);
  const state = { ...worldState(), journal:prior.journal, revision:1, turnNumber:1 };
  const draft = rerollStory(createTurnDraft(state.saveId, 1, 'stage-test', 'regular', '从现场人物的视角回顾去年'), {
    turnKind:'regular', narrative:'两人在现场会面。', summary:'会面', variableGuide:[],
  });
  return { state, draft };
}
const envelope = (commands:string) => variableTextEnvelope('<命令>\n' + commands + '\n</命令>');

describe('三段依赖与权限', () => {
  it('复用阶段一新建组织，阶段二写经营字段，候选直到结算都不修改存档', async () => {
    const {state,draft} = turn();
    const org = {...organizations[3], id:'new-org', relationHistory:[]};
    const {id,...creation} = org;
    const entities = await parseEntities('<接触者>[]</接触者>' + envelope('set organizations[' + id + '] = ' + JSON.stringify(creation)),state,draft);
    const {contactedNpcIds,...result} = entities;
    const withEntities = TurnDraftSchema.parse({...draft,entities:{contactedNpcIds,result,storyRevision:1,requestRevision:0,candidateRevision:1,validation:'structural'},stageStatus:{...draft.stageStatus,entities:'ready'}});
    const scene = startStageAttempt(withEntities,['variables']);
    await expect(parseTextVariables(envelope('set organizations[new-org].state = {"description":"替换建档说明"}'), state, scene)).rejects.toThrow();
    const candidate = await parseTextVariables(envelope('set organizations[new-org].state = {"operatingAreaText":"社区商铺"}'),state,scene);
    const ready = TurnDraftSchema.parse({...scene,variables:{result:candidate,storyRevision:1,requestRevision:scene.stageRequestRevisions.variables,candidateRevision:2,basedOnEntityRevision:1,validation:'validated'},stageStatus:{...scene.stageStatus,variables:'ready'}});
    expect(projectTurn(state,ready).organizations[id]).toMatchObject({operatingAreaText:'社区商铺'});
    expect(state.organizations[id]).toBeUndefined();
    expect(startStageAttempt(ready,['entities']).variables).toBeUndefined();
    expect(TurnDraftSchema.safeParse({...ready, entities:undefined,stageStatus:{...ready.stageStatus,entities:'pending'}}).success).toBe(false);
  });
  it('允许先声明新接触者，最终时钟约束仍会拒绝过早结算', async () => {
    const {state,draft} = turn();
    const payload = await parseEntities('<接触者>["npc-a"]</接触者>'+envelope('set npc[npc-a].lastInteractionAt = "'+actionTime+'"'),state,draft);
    const {contactedNpcIds,...result} = payload;
    const ready = TurnDraftSchema.parse({...draft,useVariableStage:false,useWorldStage:false,
      entities:{result,contactedNpcIds,storyRevision:1,candidateRevision:1,requestRevision:0,validation:'structural'},
      stageStatus:{story:'ready',entities:'ready',variables:'skipped',world:'skipped'}});
    expect(()=>validateTurnCandidates(state,ready)).toThrow();
    expect(()=>parseWorld(JSON.stringify(worldResult([{...npcUpdate(),expectedRevision:1}])),{...state,worldClock:projectedTime},ready)).toThrow();
    validateTurnCandidates({...state,worldClock:projectedTime},ready);
    expect(state.npc['npc-a'].lastInteractionAt).toBeUndefined();
  });
  it('同一接触者离场可开始任务，档案和记忆仍归人物阶段',async()=>{
    const {state,draft}=turn(), person='scene';
    const {contactedNpcIds,...result}=await parseEntities(envelope('set npc[scene].onScene = false'),state,draft);
    const before=TurnDraftSchema.parse({...draft,useVariableStage:false,entities:{contactedNpcIds,result,
      storyRevision:1,requestRevision:0,candidateRevision:1,validation:'structural'},stageStatus:{...draft.stageStatus,entities:'ready',variables:'skipped'}});
    const work={...worldResult(),taskCommands:[{type:'SaveTask',commandId:'errand',evidence:'离场办事',task:{
      ...task(),actorRef:{kind:'npc',id:person}}}]};
    expect(()=>parseWorld(JSON.stringify(work),state,before)).not.toThrow();
    expect(()=>parseWorld(JSON.stringify(work),state,draft)).toThrow();
    expect(()=>parseWorld(JSON.stringify(worldResult([{...npcUpdate(),expectedRevision:1,npcId:person}])),state,before)).toThrow();
    const note={type:'RecordNpcMemory',npcId:person,commandId:'note',evidence:'记录',knowledgeKind:'observed',
      memory:{id:'note-memory',text:'办事',createdAtGameTime:state.worldClock,sourceTurnIds:[draft.turnId],affectedEntityRefs:[{kind:'npc',id:person}],visibility:'npc_private',knowledgeSource:'本人'}};
    expect(()=>parseWorld(JSON.stringify({...worldResult(),worldCommands:[note]}),state,before)).toThrow();
  });
  it('人物阶段拒绝主角消费及没有登记为接触者的离场人物写入', async () => {
    const {state,draft}=turn();
    await expect(parseEntities(envelope('add economy.cash = -10'),state,draft)).rejects.toThrow();
    await expect(parseEntities(envelope('set npc[npc-a].healthText = "疲倦"'),state,draft)).rejects.toThrow();
  });
  it('旧阶段配置复制为两份独立选择；旧协议候选作废并保留正文', () => {
    const settings = defaultSettings(), config = defaultAiConfig();
    const {useEntityStage:_e,streamEntities:_s,...legacy} = settings.runtime;
    const {entities:_r,...routes} = config.routes;
    void _e; void _s; void _r;
    const migrated = SettingsSchema.parse({...settings,runtime:{...legacy,useVariableStage:false,streamVariables:true}});
    expect(migrated.runtime).toMatchObject({useEntityStage:false,useVariableStage:false,streamEntities:true,streamVariables:true});
    const restored=AiConfigSchema.parse({...config,routes});
    expect(restored.routes.entities).toEqual(restored.routes.variables);
    expect(restored.routes.entities).not.toBe(restored.routes.variables);
    const {draft}=turn();
    const {useEntityStage:_discard,...oldDraft}=draft;void _discard;
    const recovered=TurnDraftSchema.parse({...oldDraft,variables:{oldProtocol:true},world:{oldProtocol:true}});
    expect(recovered.story).toEqual(draft.story);
    expect([recovered.entities,recovered.variables,recovered.world]).toEqual([undefined,undefined,undefined]);
  });
});
describe('场外纪事按需加载', () => {
  it.each(['historical','scene','world'] as const)('%s 同一份场外请求包含规则与可执行目录',async scenario=>{
    const {state,draft}=turn();
    if(scenario==='historical') draft.story!.variableGuide.push({group:'time',subjectHint:'time:retrospective',textEvidence:'回顾去年',
      observedFact:JSON.stringify({npcId:'scene',perspectiveRequest:'现场人物的视角',pastRequest:'回顾去年',temporalScope:'past_only',currentPlotAdvances:false})});
    if(scenario==='scene') {
      const source={...event('closing'),sourceTurnIds:['history-1']}; state.events[source.id]=source;
      draft.useEntityStage=false;draft.stageStatus.entities='skipped';
      draft.variables={storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{
        commands:[{type:'SaveEvent',commandId:'close',evidence:'现场结束',event:{...source,status:'resolved',resolvedAt:state.worldClock,resolutionText:'已结案',sourceTurnIds:['history-1',draft.turnId]}}],rejectedSuggestions:[],unresolved:[]}};
      draft.stageStatus.variables='ready';
    }
    expect(historyCatalogReason(state,draft)).toBe(scenario==='scene'?'现场阶段已有结案候选':scenario==='historical'?'回顾往事':'场外阶段可在本批结案');
    const prompt=await composePrompt({stage:'world',state,draft,mode:'regular',userInput:draft.userInput,settings:defaultSettings()});
    expect(prompt.modules.some(item=>item.id==='shared.history_output')).toBe(true);
    expect(prompt.context.COMMAND_CATALOG).toMatchObject({ commandTypes:expect.arrayContaining(['RecordHistory']) });
  });
});
