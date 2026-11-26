// Construct identical formal data using APIs shared by the release and feature checkouts.
export async function comparisonFixture(load, scenario = 'ordinary') {
  const [{ worldState, worldNarrative, projectedTime }, { historyState }, { event },
    { createTurnDraft, rerollStory }, { GameStateSchema }] = await Promise.all([
    load('tests/fixtures/world'), load('tests/fixtures/history'), load('tests/fixtures/game'),
    load('domain/drafts'), load('domain/state'),
  ]);
  const state = worldState(), prior = historyState(1);
  Object.assign(state, { journal: prior.journal, revision: 1, turnNumber: 1,
    createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' });
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
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'compare-turn', 'regular', userInput), {
    turnKind: 'regular', narrative, summary: narrative, variableGuide,
  });
  return { state: GameStateSchema.parse(state), draft, scene };
}
export function fixedSceneCandidate(draft, commands) {
  const result = { commands: [], unresolved: [], rejectedSuggestions: [] };
  if ('useEntityStage' in draft) {
    draft.entities = { storyRevision: 1, candidateRevision: 1, requestRevision: 0,
      validation: 'structural', contactedNpcIds: [], result };
    draft.stageStatus.entities = 'ready';
  }
  draft.variables = { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated',
    ...(draft.entities ? { basedOnEntityRevision: 1 } : {}), result: { ...result, commands } };
  draft.stageStatus.variables = 'ready';
}
