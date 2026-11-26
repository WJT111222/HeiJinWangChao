// Run once per checkout in a separate process. A model is contacted only with --live.
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { log } from 'node:console';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { comparisonFixture } from './variable-comparison-fixture.mjs';

const [checkout = '.', mode = '--mock'] = process.argv.slice(2);
if (!['--live', '--mock'].includes(mode)) throw new Error('指定 --mock 或 --live');
const live = mode === '--live';
const { HEIJIN_COMPARE_MODEL: model, HEIJIN_COMPARE_ENDPOINT: endpoint, HEIJIN_COMPARE_KEY: key } = process.env;
if (live && !(model && endpoint && key)) throw new Error('真实对照需要模型、端点和临时凭证');
const server = await createServer({logLevel:'error',root:resolve(checkout), server:{middlewareMode:true}, appType:'custom'});
try {
  const load = path => server.ssrLoadModule('/src/' + path + '.ts');
  const [{ runStageRequest }, { AiClient }, { defaultAiConfig, newChannel }, { defaultSettings },
    { startStageAttempt, TurnDraftSchema }, { selectVariableDomains }, { selectWorldDomains }, { projectTurn },
    { validateTurnCandidates }, { settleTurn }, { variableReply }] = await Promise.all([
    load('services/ai/runtime'),load('services/ai/client'),load('services/ai/configuration'),load('ui/settings/model'),
    load('domain/drafts'),load('prompts/variableDomains'),load('prompts/worldDomains'),load('domain/turnProjection'),
    load('services/validation/turnCommit'),load('domain/turnCommit'),load('tests/fixtures/variableReply')]);
  const {requestInspections} = await load('services/ai/inspection');
  const fixture = await comparisonFixture(load), {state} = fixture;
  let draft = fixture.draft;
  const settings = defaultSettings(), config = defaultAiConfig(), channel = newChannel('openai');
  channel.defaultModel = live ? model : 'fixture-model';
  channel.baseUrl = live ? endpoint : 'https://fixture.invalid/v1';
  channel.parameters = {temperature:0, maxOutputTokens:8192};
  config.channels = [channel];
  config.routes.story = {channelId:channel.id, modelId:channel.defaultModel};
  const stages = 'useEntityStage' in draft ? ['entities','variables','world'] : ['variables','world'];
  const identity = createHash('sha256').update(JSON.stringify({state, story:draft.story, userInput:draft.userInput})).digest('hex');
  const report = {run:live ? 'real-model' : 'simulated', commit:execFileSync('git',['-C',resolve(checkout),'rev-parse','HEAD'],{encoding:'utf8'}).trim(), identicalInput:identity, model:channel.defaultModel, parameters:channel.parameters,
    protocol:channel.protocol, stages:[], settled:false};
  const start = performance.now();
  try {
    for (const stage of stages) {
      const at = performance.now();
      const record = {stage};
      report.stages.push(record);
      try {
        draft = startStageAttempt(draft,[stage]);
        const selection = stage === 'world' ? selectWorldDomains(projectTurn(state,draft),draft) : selectVariableDomains(state,draft,stage);
        const client = live ? new AiClient() : new AiClient(async () => {
          const content = stage === 'entities' ? '<接触者>[]</接触者>' + variableReply({commands:[]}) :
            stage === 'variables' ? variableReply({commands:fixture.scene}) :
            JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
          return globalThis.Response.json({choices:[{message:{content},finish_reason:'stop'}]});
        });
        const reply = await runStageRequest({stage,state,draft,mode:'regular',settings,userInput:draft.userInput,domains:selection.domains},
          config,{get:() => live ? key : 'comparison-fixture-secret'},{stream:false},client);
        const {contactedNpcIds, ...result} = reply.result;
        record.usage = reply.usage ?? null;
        record.result = result;
        const candidate = {storyRevision:draft.storyRevision,requestRevision:draft.stageRequestRevisions[stage],
          candidateRevision:draft.executionRevision,validation:stage==='entities' ? 'structural' : 'validated',result};
        if (stage === 'entities') candidate.contactedNpcIds = contactedNpcIds;
        if (stage !== 'entities' && draft.entities) candidate.basedOnEntityRevision = draft.entities.candidateRevision;
        if (stage === 'world') candidate.basedOnVariableRevision = draft.variables?.candidateRevision;
        draft = TurnDraftSchema.parse({...draft,[stage]:candidate,stageStatus:{...draft.stageStatus,[stage]:'ready'}});
      } finally {
        const actual = requestInspections.getSnapshot().find(item => item.stage === stage)?.statistics.actual;
        record.usage ??= actual && Object.values(actual).some(value => value !== undefined) ? actual : null;
        record.elapsedMs = Math.round(performance.now()-at);
      }
    }
    validateTurnCandidates(state,draft);
    const next = settleTurn(state,draft,state.updatedAt);
    report.settled = true;
    report.finalState = {cash:next.economy.cash,worldClock:next.worldClock};
  } catch (error) {
    report.failure = {code:error.code ?? error.name, details:error.details};
    process.exitCode = 1;
  }
  report.totalElapsedMs = Math.round(performance.now()-start);
  log(JSON.stringify(report,null,2));
} finally { await server.close(); }
