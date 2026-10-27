import { describe, expect, it } from 'vitest';
import { captureVariableTextPreviewBasis, previewVariableTextReply } from '../bridges/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

function fixture() {
  const state = game(); state.npc.npc_001 = npc('npc_001');
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-preview', 'opening', ''), { ...story, turnKind: 'opening' });
  return { state, draft };
}
const reply = `<thinking>仅为离线样本。</thinking>\n<说明>更新普通文本状态。</说明>\n<命令>\nset protagonist.emotionText = "心情平静"\nset npc[npc_001].healthText = "略感疲惫"\n</命令>`;

describe('M8-P0C-3A离线桥接', () => {
  it('完整格式经真实解析/编译/模拟，仅返回preview_only且不修改输入', async () => {
    const { state, draft } = fixture(), before = structuredClone({ state, draft });
    const captured = await captureVariableTextPreviewBasis(state, draft);
    expect(captured.ok).toBe(true); if (!captured.ok) return;
    const result = await previewVariableTextReply(reply, state, draft, captured.value);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result).toMatchObject({ mode: 'preview_only', commandCount: 2 });
    expect(result.previewState.protagonist.emotionText).toBe('心情平静');
    expect(result.previewState.npc.npc_001.healthText).toBe('略感疲惫');
    expect({ state, draft }).toEqual(before);
    expect(result).not.toHaveProperty('commands'); expect(result).not.toHaveProperty('proofs'); expect(result).not.toHaveProperty('plan');
  });
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error('固定样本准备失败'); return result.value;
}
const block = (body: string) => `<说明>普通离线样本。</说明>\n<命令>\n${body}\n</命令>`;
async function preview(body: string, data = fixture()) {
  const basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
  return previewVariableTextReply(block(body), data.state, data.draft, basis);
}
function expectFailure(result: import('../bridges/variableText').TextVariablePreviewResult, code: string, stage?: string) {
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ mode: 'preview_only', audience: 'internal' });
  expect(result).not.toHaveProperty('previewState'); expect(result).not.toHaveProperty('commands');
  if (!result.ok) { expect(result.error.code).toBe(code); if (stage) expect(result.failedAt).toBe(stage); }
}

describe('版本、基线与旧正文', () => {
  it.each(['saveId', 'revision'] as const)('正式%s不匹配时拒绝', async (field) => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const state = { ...data.state, [field]: field === 'revision' ? 1 : 'other-save' };
    expectFailure(await previewVariableTextReply(reply, state, data.draft, basis), 'revision_conflict', 'input');
  });
  it('已经提交的turnId不能再次预演', async () => {
    const data = fixture(); data.state.revision = 1; data.state.turnNumber = 1;
    data.state.journal.push({ turnId: data.draft.turnId, revision: 1, story, relatedActorRefs: [] });
    data.draft = rerollStory(createTurnDraft(data.state.saveId, 1, data.draft.turnId, 'regular', ''), story);
    expect((await captureVariableTextPreviewBasis(data.state, data.draft))).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
  });
  it('已存在同回合独立命令记录也不当成新的正式基线', async () => {
    const data = fixture(), { commitCommands } = await import('../domain/commands');
    const state = commitCommands(data.state, data.draft.turnId, 0, [{ type: 'SpendFunds', commandId: 'old', account: 'cash', amount: 1, purpose: '旧操作', evidence: '旧来源' }], data.state.updatedAt);
    data.draft.baseSaveRevision = state.revision;
    expect((await captureVariableTextPreviewBasis(state, data.draft))).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
  });
  it.each(['pending', 'failed'] as const)('正文%s不预演', async (status) => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft)); data.draft.stageStatus.story = status;
    expectFailure(await previewVariableTextReply(reply, data.state, data.draft, basis), 'story_not_ready', 'input');
  });
  it('正文缺失、零版本均明确拒绝', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const missing = createTurnDraft(data.state.saveId, 0, data.draft.turnId, 'opening', '');
    expectFailure(await previewVariableTextReply(reply, data.state, missing, basis), 'story_not_ready', 'input');
    expectFailure(await previewVariableTextReply(reply, data.state, { ...data.draft, storyRevision: 0 }, basis), 'story_not_ready', 'input');
  });
  it('开局/普通回合类型与正式回合数不匹配时拒绝', async () => {
    const data = fixture(); const draft = rerollStory(createTurnDraft(data.state.saveId, 0, 'turn-preview', 'regular', ''), story);
    expect(await captureVariableTextPreviewBasis(data.state, draft)).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
  });
  it('正文Roll后的旧基线不能重绑给新正文', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const next = rerollStory(data.draft, { ...story, turnKind: 'opening', narrative: '新的正文' });
    expectFailure(await previewVariableTextReply(reply, data.state, next, basis), 'revision_conflict', 'input');
  });
  it('即使版本号未改，正文内容变化也使旧结果失效', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft)); data.draft.story!.narrative = '不同正文';
    expectFailure(await previewVariableTextReply(reply, data.state, data.draft, basis), 'revision_conflict', 'input');
  });
  it.each(['draftRevision', 'executionRevision', 'stageRequestRevisions', 'turnId'] as const)('基线绑定%s', async (field) => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const changed = { ...basis, [field]: field === 'stageRequestRevisions' ? { variables: 1, world: 0 } : field === 'turnId' ? 'other-turn' : 99 };
    expectFailure(await previewVariableTextReply(reply, data.state, data.draft, changed), 'revision_conflict', 'input');
  });
  it('显式补算会改变执行基线，不能沿用旧离线结果', async () => {
    const { startStageAttempt } = await import('../domain/drafts'); const data = fixture();
    const basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    expectFailure(await previewVariableTextReply(reply, data.state, startStageAttempt(data.draft, ['variables']), basis), 'revision_conflict', 'input');
  });
  it('同revision内部资料改变也会拒绝旧快照', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    data.state.npc.npc_001.healthText = '刚更新的正式状态';
    expectFailure(await previewVariableTextReply(reply, data.state, data.draft, basis), 'revision_conflict', 'input');
  });
  it('没有基线的无版本原文不能被当作当前正文回复', async () => {
    const data = fixture();
    const result = await Reflect.apply(previewVariableTextReply, undefined, [reply, data.state, data.draft]);
    expectFailure(result, 'revision_conflict', 'input');
  });
});

describe('纯函数与错误诊断', () => {
  it('相同输入得到相同基线与预演，不产生永久原文或记忆', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const a = await previewVariableTextReply(reply, data.state, data.draft, basis), b = await previewVariableTextReply(reply, data.state, data.draft, basis);
    expect(a).toEqual(b); if (!a.ok) throw new Error('预演失败');
    expect(a.previewState).not.toHaveProperty('journal'); expect(a.previewState).not.toHaveProperty('memories');
    expect(a.previewState).not.toHaveProperty('appliedCommands'); expect(a.previewState).not.toHaveProperty('economy');
    expect(a.previewState.worldClock).toBe(data.state.worldClock);
  });
  it('解析器产生的AST、输入状态和草稿均可被冻结且不被改变', async () => {
    const { vi } = await import('vitest'), parser = await import('../parsers/variableText');
    const original = parser.parseVariableText, ast = unwrap(original(reply)), saved = structuredClone(ast);
    function freeze(value: unknown) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } }
    freeze(ast);
    const parse = vi.spyOn(parser, 'parseVariableText').mockReturnValue({ ok: true, value: ast });
    try {
      const data = fixture(), before = structuredClone(data); freeze(data);
      const basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
      expect((await previewVariableTextReply(reply, data.state, data.draft, basis)).ok).toBe(true);
      expect(ast).toEqual(saved); expect(data).toEqual(before);
    } finally { parse.mockRestore(); }
  });
  it('编译输入不是正式授权：返回值不能直接用作旧变量候选', async () => {
    const { VariableResultSchema, TurnDraftSchema } = await import('../domain/drafts');
    const result = await preview('set protagonist.emotionText = "平静"');
    expect(result.ok).toBe(true); expect(VariableResultSchema.safeParse(result).success).toBe(false);
    const data = fixture();
    expect(TurnDraftSchema.safeParse({ ...data.draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result }, stageStatus: { ...data.draft.stageStatus, variables: 'ready' } }).success).toBe(false);
    expect(result).not.toHaveProperty('authorizedForCommit'); expect(result).not.toHaveProperty('plan');
  });
  it('空命令块可以预演，不把缺失块当空变更', async () => {
    const result = await preview(''); expect(result.ok).toBe(true); if (result.ok) expect(result.commandCount).toBe(0);
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    expectFailure(await previewVariableTextReply('<说明>没有命令</说明>', data.state, data.draft, basis), 'missing_block', 'parsing');
  });
  it('JSON格式错误带原始命令序号和行列，但不泄露回复', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const result = await previewVariableTextReply(block('set protagonist.emotionText = "安全"\nset protagonist.healthText = {"secret":"PRIVATE-KEY",}'), data.state, data.draft, basis);
    expectFailure(result, 'json_value', 'parsing');
    if (!result.ok && result.origin === 'parser') expect(result.error).toMatchObject({ commandIndex: 2, position: { line: 4 } });
    expect(result.progress).toEqual({ input: 'passed', parsing: 'failed', compilation: 'not_run', simulation: 'not_run' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-KEY');
  });
  it('类型错误仍由真实编译器拒绝，保留执行器错误和原始位置', async () => {
    const result = await preview('set protagonist.healthText = 123');
    expectFailure(result, 'type_mismatch', 'compilation');
    expect(result.progress).toMatchObject({ parsing: 'passed', compilation: 'failed', simulation: 'not_run' });
    if (!result.ok && result.origin === 'executor') expect(result.error).toMatchObject({ commandIndex: 1, source: { start: { line: 3, column: 1 } } });
  });
  it('领域模拟失败不返回部分状态', async () => {
    const { vi } = await import('vitest'), executor = await import('../executors/variableText'), { failed } = await import('../executors/variableText/model');
    const simulate = vi.spyOn(executor, 'simulateVariablePlan').mockResolvedValue(failed('transaction_failed'));
    try {
      const data = fixture(), before = structuredClone(data), result = await preview('set protagonist.emotionText = "轻松"', data);
      expectFailure(result, 'transaction_failed', 'simulation'); expect(data).toEqual(before);
      expect(result.progress).toMatchObject({ compilation: 'passed', simulation: 'failed' });
    } finally { simulate.mockRestore(); }
  });
  it('未预期异常不泄露供应商或内部错误内容', async () => {
    const { vi } = await import('vitest'), executor = await import('../executors/variableText');
    const simulate = vi.spyOn(executor, 'simulateVariablePlan').mockRejectedValue(new Error('Authorization PRIVATE-MEMORY SECRET-KEY'));
    try {
      const result = await preview('set protagonist.emotionText = "轻松"'); expectFailure(result, 'preview_failed', 'simulation');
      expect(JSON.stringify(result)).not.toMatch(/Authorization|PRIVATE-MEMORY|SECRET-KEY/);
    } finally { simulate.mockRestore(); }
  });
  it('预演期间输入正文被改变则丢弃旧结果，而非返回旧状态', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const pending = previewVariableTextReply(reply, data.state, data.draft, basis);
    data.draft.story!.narrative = '期间已经选择了另一份正文';
    expectFailure(await pending, 'revision_conflict', 'input');
  });
  it('模拟期间换版本也不返回旧结果', async () => {
    const { vi } = await import('vitest'), executor = await import('../executors/variableText');
    const original = executor.simulateVariablePlan, data = fixture();
    const basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const simulate = vi.spyOn(executor, 'simulateVariablePlan').mockImplementation(async (...args) => {
      const result = await original(...args); data.draft.draftRevision++; return result;
    });
    try { expectFailure(await previewVariableTextReply(reply, data.state, data.draft, basis), 'revision_conflict', 'simulation'); }
    finally { simulate.mockRestore(); }
  });
  it('捕获基线期间状态变化也明确失败', async () => {
    const data = fixture(), pending = captureVariableTextPreviewBasis(data.state, data.draft); data.state.protagonist.emotionText = '刚更新';
    expect(await pending).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
  });
  it('无AI、网络或IndexedDB访问', async () => {
    const { vi } = await import('vitest'), { AiClient } = await import('../services/ai/client');
    const generate = vi.spyOn(AiClient.prototype, 'generate'), fetch = vi.fn(), indexedDB = { open: vi.fn() };
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('indexedDB', indexedDB);
    try { expect((await preview('set protagonist.emotionText = "平静"')).ok).toBe(true);
      expect(generate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(indexedDB.open).not.toHaveBeenCalled();
    } finally { generate.mockRestore(); vi.unstubAllGlobals(); }
  });
});

describe('开局、旧档及原工作流隔离', () => {
  it('开局时间待定但没有合法结构化时间，编译失败且不取设备日期', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime'); const data = fixture();
    data.state.openingTimePending = true; data.state.worldClock = pendingOpeningClock;
    const result = await preview('set protagonist.emotionText = "平静"', data);
    expectFailure(result, 'domain_validation_failed', 'compilation'); expect(data.state.worldClock).toBe(pendingOpeningClock);
  });
  it('合法开局时间复用原执行器，内存结果与Story一致，正式时钟仍待定', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime'); const data = fixture();
    data.state.openingTimePending = true; data.state.worldClock = pendingOpeningClock;
    data.draft.story!.variableGuide.push({ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:05:00+08:00' }) });
    const result = await preview('set protagonist.healthText = "疲惫"', data); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.previewState.worldClock).toBe('2015-06-01T08:05:00+08:00'); expect(result.previewState.clockKind).toBe('opening_candidate'); }
    expect(data.state.openingTimePending).toBe(true); expect(data.state.worldClock).toBe(pendingOpeningClock);
  });
  it('旧无待定标记的开局保留原时钟，不重解释旧年代', async () => {
    const data = fixture(), result = await preview('set protagonist.healthText = "健康"', data);
    expect(result.ok).toBe(true); if (result.ok) expect(result.previewState.worldClock).toBe(data.state.worldClock);
  });
  it('普通已提交回合基线支持文本预演，既有journal不改写', async () => {
    const data = fixture(); data.state.revision = 1; data.state.turnNumber = 1;
    data.state.journal = [{ turnId: 'previous', revision: 1, story, relatedActorRefs: [] }];
    data.draft = rerollStory(createTurnDraft(data.state.saveId, 1, 'new-regular-turn', 'regular', ''), story);
    const before = structuredClone(data), result = await preview('set protagonist.emotionText = "平静"', data);
    expect(result.ok).toBe(true); expect(data).toEqual(before);
    if (result.ok) expect(result.previewState).not.toHaveProperty('journal');
  });
  it('旧草稿缺省执行版本由原Schema读取，不原地补字段', async () => {
    const data = fixture(); Reflect.deleteProperty(data.draft, 'executionRevision'); Reflect.deleteProperty(data.draft, 'stageRequestRevisions'); Reflect.deleteProperty(data.draft, 'requestedStages');
    const result = await preview('set protagonist.emotionText = "平静"', data);
    expect(result.ok).toBe(true); expect(data.draft).not.toHaveProperty('executionRevision');
    if (result.ok) expect(result.basis).toMatchObject({ executionRevision: 0, stageRequestRevisions: { variables: 0, world: 0 } });
  });
  it('旧JSON变量、世界验证及正式原子结算继续使用原候选结构', async () => {
    const { parseVariables, parseWorld } = await import('../services/validation/aiOutputs');
    const { worldDraft, worldState, worldResult } = await import('./fixtures/world');
    const { TurnDraftSchema } = await import('../domain/drafts'), { settleTurn } = await import('../domain/turnCommit');
    const state = worldState(), draft = worldDraft(true, 'opening'), before = structuredClone(state), result = worldResult();
    expect(parseVariables(JSON.stringify(draft.variables!.result), state, draft)).toEqual(draft.variables!.result);
    expect(parseWorld(JSON.stringify(result), state, draft)).toEqual(result);
    const complete = TurnDraftSchema.parse({ ...draft, world: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, basedOnVariableRevision: 1, validation: 'validated', result }, stageStatus: { ...draft.stageStatus, world: 'ready' } });
    const settled = settleTurn(state, complete, state.updatedAt);
    expect(settled.turnNumber).toBe(1); expect(settled.economy.cash).toBe(7000); expect(state).toEqual(before);
  });
  it('已有旧变量候选不被当作新的预演授权，不修改旧草稿或叠加消费', async () => {
    const { worldDraft } = await import('./fixtures/world'); const data = fixture(); data.draft = worldDraft(true, 'opening');
    const { vi } = await import('vitest'), executor = await import('../executors/variableText');
    const simulate = vi.spyOn(executor, 'simulateVariablePlan');
    try {
      const before = structuredClone(data), result = await preview('set protagonist.emotionText = "平静"', data);
      expect(result.ok).toBe(true); expect(data).toEqual(before);
      const internal = await simulate.mock.results[0].value;
      expect(internal.ok).toBe(true); if (internal.ok) expect(internal.value.economy.cash).toBe(data.state.economy.cash);
    } finally { simulate.mockRestore(); }
  });
  it('无有效state/draft输入时返回安全错误而不抛异常', async () => {
    const data = fixture(), basis = unwrap(await captureVariableTextPreviewBasis(data.state, data.draft));
    const invalid = await Reflect.apply(previewVariableTextReply, undefined, [reply, null, data.draft, basis]);
    expectFailure(invalid, 'invalid_state', 'input');
    expectFailure(await Reflect.apply(previewVariableTextReply, undefined, [reply, data.state, null, basis]), 'invalid_draft', 'input');
  });
  it('旧运行时和持久存储不导入桥接，新模块不导入IO或执行领域赋值', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    for (const file of ['src/workflows/variableStage.ts', 'src/workflows/worldStage.ts', 'src/workflows/turnCoordinator.ts', 'src/services/ai/runtime.ts', 'src/services/storage/saveRepository.ts', 'src/domain/turnCommit.ts', 'src/domain/turnProjection.ts'])
      expect(readFileSync(file, 'utf8')).not.toContain('bridges/variableText');
    for (const name of readdirSync('src/bridges/variableText')) {
      const source = readFileSync(`src/bridges/variableText/${name}`, 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*(?:storage|services\/ai|workflows|ui\/)/);
      expect(source).not.toMatch(/\bcommitCommands\s*\(|\beval\s*\(|new\s+Function|\bfetch\s*\(|\bconsole\./);
    }
  });
});

describe('输出只读投影和隐私边界', () => {
  it('成功结果不带出未涉及人物、私人记忆、内部事件、ledger或合成审计信息', async () => {
    const data = fixture(); data.state.npc.hidden = { ...npc('hidden'), onScene: false, name: 'HIDDEN-NAME', healthText: 'HIDDEN-HEALTH' };
    data.state.npc.npc_001.memories.push({ id: 'private', text: 'PRIVATE-MEMORY', knowledgeSource: 'PRIVATE-SOURCE',
      sourceTurnIds: ['old'], affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }], createdAtGameTime: data.state.worldClock, visibility: 'npc_private' });
    const result = await preview('set npc[npc_001].healthText = "健康"', data); expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/HIDDEN-NAME|HIDDEN-HEALTH|PRIVATE-MEMORY|PRIVATE-SOURCE/);
    if (result.ok) {
      expect(Object.keys(result.previewState.npc)).toEqual(['npc_001']);
      expect(result.previewState.npc.npc_001).not.toHaveProperty('memories');
      const { GameStateSchema } = await import('../domain/state'); expect(GameStateSchema.safeParse(result.previewState).success).toBe(false);
    }
  });
  it('预演不改变已有候选、执行版本或关闭的阶段开关', async () => {
    const data = fixture();
    data.draft = rerollStory(createTurnDraft(data.state.saveId, 0, 'turn-preview', 'opening', '', false, false), { ...story, turnKind: 'opening' });
    const before = structuredClone(data), result = await preview('set protagonist.healthText = "健康"', data);
    expect(result.ok).toBe(true); expect(data).toEqual(before);
    expect(data.draft.useVariableStage).toBe(false); expect(data.draft.useWorldStage).toBe(false);
  });
});
