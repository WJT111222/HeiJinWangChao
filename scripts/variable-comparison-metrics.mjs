// Score only the fixture's explicit facts, offline. Keep every extra command for review.
function matches(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (Object.hasOwn(expected, '$contains')) {
      return typeof actual === 'string' && actual.includes(expected.$contains);
    }
    return actual != null && Object.entries(expected).every(([key, value]) => matches(actual[key], value));
  }
  if (typeof expected === 'string' && /^\d{4}-\d\d-\d\dT/u.test(expected)) {
    return typeof actual === 'string' && Date.parse(actual) === Date.parse(expected);
  }
  return actual === expected;
}

export function resultCommands(result) {
  return [...(result?.commands ?? []), ...(result?.worldCommands ?? []),
    ...(result?.taskCommands ?? []), ...(result?.eventCommands ?? [])];
}

function finalSkips(report) {
  const skipped = Object.values(report.settlement ?? {}).flatMap(summary => summary?.skipped ?? []);
  // A whole normalized-away World command (e.g. #186) has no receipt or journal skip.
  // The world envelope and journal both number worldCommands, taskCommands, eventCommands in that order.
  const world = report.stages.find(stage => stage.stage === 'world');
  const isolated = new Set(report.settlement?.world?.skipped?.map(entry => entry.commandIndex));
  const accepted = new Set(resultCommands(world?.result).map(command => command.commandId));
  const normalized = (world?.proposed ?? []).flatMap((command, commandIndex) =>
    typeof command?.commandId === 'string' && !isolated.has(commandIndex) && !accepted.has(command.commandId)
      ? [{group: 'world', commandIndex, commandId: command.commandId, reason: 'normalized'}] : []);
  return [...skipped, ...normalized];
}

export function fixtureMetrics(report, expected) {
  const stages = report.stages;
  const accepted = stages.flatMap(stage => resultCommands(stage.result));
  const executed = report.executedCommands ?? [];
  const skipped = report.settled ? finalSkips(report) : null;
  const counts = {
    proposed: stages.every(stage => Array.isArray(stage.proposed))
      ? stages.reduce((sum, stage) => sum + stage.proposed.length, 0) : null,
    accepted: accepted.length,
    executed: executed.length,
    skipped: skipped?.length ?? null,
  };
  const actual = stages.map(stage => stage.usage);
  function sumUsage(field) {
    return actual.length && actual.every(usage => Number.isFinite(usage?.[field]))
      ? actual.reduce((sum, usage) => sum + usage[field], 0) : null;
  }
  const statistics = {
    counts, skippedCommands: counts.skipped, skipped, failure: report.failure?.code ?? null,
    reportedUsage: {inputTokens: sumUsage('inputTokens'), outputTokens: sumUsage('outputTokens'), totalTokens: sumUsage('totalTokens')},
  };
  if (!report.settled) return {...statistics, missing: null, incorrect: null, duplicates: null, otherCommands: null};

  const remaining = [...executed], missing = [], incorrect = [], duplicates = [], otherCommands = [];
  const unmatched = [];
  // Fixture expectations put more specific facts last. Each real write may satisfy only one expectation.
  for (const fact of [...expected].reverse()) {
    const index = remaining.findIndex(command => matches(command, fact));
    if (index < 0) unmatched.push(fact);
    else remaining.splice(index, 1);
  }
  for (const fact of unmatched) {
    const index = remaining.findIndex(command => command.type === fact.type);
    if (index < 0) missing.push(fact);
    else incorrect.push({expected: fact, actual: remaining.splice(index, 1)[0]});
  }
  for (const command of remaining) {
    if (expected.some(fact => matches(command, fact))) duplicates.push(command);
    else otherCommands.push(command);
  }
  return {...statistics, missing, incorrect, duplicates, otherCommands};
}
