// Construct identical formal data using APIs shared by the release and feature checkouts.
export async function comparisonFixture(load, scenario = 'ordinary') {
  const [{ worldState, worldNarrative, projectedTime }, { historyState }, { event, organizations },
    { createTurnDraft, rerollStory }, { GameStateSchema }] = await Promise.all([
    load('tests/fixtures/world'), load('tests/fixtures/history'), load('tests/fixtures/game'),
    load('domain/drafts'), load('domain/state'),
  ]);
  const state = worldState(), prior = historyState(1);
  Object.assign(state, { journal: prior.journal, revision: 1, turnNumber: 1,
    createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' });
  const mode = scenario.startsWith('opening') ? 'opening' : 'regular';
  if (mode === 'opening') Object.assign(state, { journal: [], revision: 0, turnNumber: 0 });
  if (scenario.includes('organizations')) {
    for (const template of organizations) {
      const id = 'compare-' + template.kind;
      state.organizations[id] = { ...template, id };
    }
  }
  let userInput = '和现场人物吃饭，用现金付30元。';
  let narrative = worldNarrative, variableGuide = [];
  const scene = [{ type: 'SetWorldClock', commandId: 'clock', worldClock: projectedTime, evidence: '经过十分钟' },
    { type: 'SpendFunds', commandId: 'meal', account: 'cash', amount: 3000, purpose: '用餐', evidence: '现金支付30元' }];
  if (scenario === 'historical') {
    userInput = '从现场人物的视角，回顾去年用餐的往事。';
    narrative = '现场人物回忆去年用餐的经历，当前时间没有推进。';
    variableGuide = [{ group: 'time', subjectHint: 'time:retrospective', textEvidence: '回顾往事',
      observedFact: JSON.stringify({ npcId: 'scene', perspectiveRequest: '现场人物的视角', pastRequest: '回顾去年', temporalScope: 'past_only', currentPlotAdvances: false }) }];
    scene.length = 0;
  }
  if (scenario === 'scene-closure') {
    const priorEvent = { ...event('meal-meeting'), status: 'active', sourceTurnIds: ['history-1'] };
    state.events[priorEvent.id] = priorEvent;
    narrative += '本次现场会谈正式结束。';
    scene.push({ type: 'SaveEvent', commandId: 'close-meeting', evidence: '会谈结束', event: {
      ...priorEvent, status: 'resolved', resolvedAt: projectedTime, resolutionText: '会谈完成', sourceTurnIds: ['history-1', 'compare-turn'],
    } });
  }
  if (scenario === 'phone-inbox') {
    const { recordPhone, schedulePhone } = await load('domain/phone');
    for (const person of Object.values(state.npc)) {
      person.appearedInStory = true;
      for (let i = 0; i < 12; i++) recordPhone(state, person.id, {messageId:person.id+'-past-'+i,
        sender:'npc', medium:'text', text:'资料放在楼下，请留意签收。'}, 'history-1', false);
      if (!person.onScene) schedulePhone(state,{messageId:person.id+'-due',npcId:person.id,dueAt:projectedTime,text:'前台已经收到了。'},'history-1');
    }
  }
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'compare-turn', mode, userInput), {
    turnKind: mode, narrative, summary: narrative, variableGuide,
  });
  return { state: GameStateSchema.parse(state), draft, scene };
}
export function fixedEntityCandidate(draft) {
  const result = { commands: [], unresolved: [], rejectedSuggestions: [] };
  if ('useEntityStage' in draft) {
    draft.entities = { storyRevision: 1, candidateRevision: 1, requestRevision: 0,
      validation: 'structural', contactedNpcIds: [], result };
    draft.stageStatus.entities = 'ready';
  }
}
export function fixedSceneCandidate(draft, commands) {
  fixedEntityCandidate(draft);
  const result = { unresolved: [], rejectedSuggestions: [] };
  draft.variables = { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated',
    ...(draft.entities ? { basedOnEntityRevision: 1 } : {}), result: { ...result, commands } };
  draft.stageStatus.variables = 'ready';
}

export const modelComparisonScenarios = ['ordinary', 'new-person', 'new-faction', 'event-sequence'];

// The same input and offline expectations are used with both protocol versions.
export async function modelComparisonFixture(load, scenario) {
  if (!modelComparisonScenarios.includes(scenario)) throw new Error('未知实模对照样本：' + scenario);
  const {state,draft,scene} = await comparisonFixture(load);
  const {npc,organizations,event,task} = await load('tests/fixtures/game');
  const endAt = scene[0].worldClock;
  const clock = 'set worldClock = ' + JSON.stringify(endAt);
  const expectedClock = {type:'SetWorldClock',worldClock:endAt};
  const sample = {state,draft,contacts:[],entityLines:[],sceneLines:[clock],worldCommands:[],
    expected:() => [expectedClock]};
  function selectStory(action, narrative) {
    draft.userInput = action;
    draft.story = {...draft.story,narrative,summary:narrative};
  }
  if (scenario === 'ordinary') {
    sample.sceneLines.push('add economy.cash = -3000');
    sample.expected = () => [expectedClock,{type:'SpendFunds',account:'cash',amount:3000}];
  }
  if (scenario === 'new-person') {
    const name = '周岑';
    selectStory('请当班的周岑负责清点今天的收据。','08:00，主角第一次见到本周将持续协作的登记员周岑。两人留在现场核对了十分钟。08:10，周岑接下清点收据的任务，约定明天八点前交接清单。');
    const {id,...person} = {...npc('receipt-clerk'),name,affinity:0,relationshipText:'初次会面'};
    const duty = {...task('receipt-audit'),goal:'清点收据',startAt:endAt,dueAt:'2026-10-19T08:00:00+08:00',actorRef:{kind:'npc',id}};
    const {id:taskId,...fields}=duty;
    sample.contacts=[id];
    sample.entityLines=['set npc['+id+'] = '+JSON.stringify(person)];
    sample.sceneLines.push('set tasks['+taskId+'] = '+JSON.stringify(fields));
    sample.expected = next => {
      const actorId = Object.values(next?.npc ?? {}).find(person => person.name === name)?.id;
      return [expectedClock,{type:'CreateNpc',npc:{name,onScene:true}},{type:'SaveTask',task:{actorRef:{kind:'npc',id:actorId ?? '(未建档)'},dueAt:duty.dueAt}}];
    };
  }
  if (scenario === 'new-faction') {
    const name='青桥商贸公司', relation='正式成员';
    selectStory('接受青桥商贸公司的正式邀请，加入公司。','08:00，主角首次见到青桥商贸公司的负责人。十分钟后入职手续办完，主角成为公司的正式成员，职位为职员。这是主角唯一的主势力。');
    const {id,...org}={...organizations[3],id:'qingqiao',name,protagonistRelation:relation,relationHistory:[]};
    sample.entityLines=['set organizations['+id+'] = '+JSON.stringify(org)];
    sample.sceneLines.push('set organizations['+id+'].protagonistRelation = '+JSON.stringify({relation,reason:'正式入职',faction:{action:'bind',position:'职员',bondText:'正式入职'}}));
    sample.expected = next => {
      const orgId=Object.values(next?.organizations ?? {}).find(org => org.name===name)?.id;
      return [expectedClock,{type:'CreateOrganization',organization:{name,kind:'business'}},{type:'RecordOrgRelation',organizationId:orgId ?? '(未建档)',faction:{action:'bind',position:'职员'}}];
    };
  }
  if (scenario === 'event-sequence') {
    selectStory('到场办理预约，按现场进度记录。','08:00，主角的预约如期开办。十分钟后窗口因设备故障停止办理，本次预约受阻。后台随后把北楼登记为备用会场，预约仍未恢复。');
    const scheduled={...event('review'),estimatedEndAt:'2026-10-20T08:00:00+08:00',sourceTurnIds:['history-1']};
    state.events.review=scheduled;
    sample.sceneLines.push('set events[review].sceneState = {"status":"active"}','set events[review].sceneState = {"status":"blocked"}');
    sample.worldCommands=[{type:'SaveEvent',commandId:'venue-note',evidence:'后台登记备用会场',event:{...scheduled,status:'blocked',backgroundText:'备用会场为北楼',sourceTurnIds:[...scheduled.sourceTurnIds,draft.turnId]}}];
    sample.expected=()=>[expectedClock,{type:'SaveEvent',event:{id:'review',status:'active'}},{type:'SaveEvent',event:{id:'review',status:'blocked'}},
      {type:'SaveEvent',event:{id:'review',status:'blocked',backgroundText:{$contains:'北楼'}}}];
  }
  return sample;
}
