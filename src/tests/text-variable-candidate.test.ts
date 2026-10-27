import { describe, expect, it } from 'vitest';
import { captureTextVariableRequestBasis, prepareTextVariableCandidate, verifyTextVariableCandidateSync } from '../candidates/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

function fixture() {
  const state = game(); state.npc.npc_001 = npc('npc_001');
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'text-turn', 'opening', ''), { ...story, turnKind: 'opening' });
  return { state, draft };
}
function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T { if (!r.ok) throw new Error('固定样本准备失败'); return r.value; }
const text = `<thinking>不应进入候选的分析。</thinking>\n<说明>普通文本状态修改。</说明>\n<命令>\nset protagonist.emotionText = "平静"\nset npc[npc_001].healthText = "略感疲惫"\n</命令>`;

describe('唯一文本变量候选', () => {
  it('真实解析、授权、编译、领域模拟后可同步复核，仍不代表完整业务已结算', async () => {
    const { state, draft } = fixture(), before = structuredClone({ state, draft });
    const basis = unwrap(captureTextVariableRequestBasis(state, draft));
    const prepared = unwrap(await prepareTextVariableCandidate(text, state, draft, basis));
    expect(prepared.candidate.protocol).toBe('text-v1'); expect(prepared.candidate.status).toBe('prepared');
    const result = verifyTextVariableCandidateSync(prepared.candidate, state, draft, prepared.seal);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.commands.map((c) => c.type)).toEqual(['UpdateProtagonist', 'UpdateNpc']);
    expect(result.value.commitAllowed).toBe(false); expect(result.value.coverage.complete).toBe(false);
    expect({ state, draft }).toEqual(before);
  });
});

const block = (body: string) => `<说明>固定样本</说明>\n<命令>\n${body}\n</命令>`;
async function prepared(body = 'set protagonist.emotionText = "平静"\nset npc[npc_001].healthText = "疲惫"', data = fixture()) {
  const request = unwrap(captureTextVariableRequestBasis(data.state, data.draft));
  const result = unwrap(await prepareTextVariableCandidate(block(body), data.state, data.draft, request));
  return { ...data, ...result, request };
}
function expectCode(result: { ok: boolean; error?: { code: string } }, code?: string) {
  expect(result.ok).toBe(false); if (code) expect(result.error?.code).toBe(code);
  expect(result).not.toHaveProperty('value');
}

describe('候选格式与授权准备', () => {
  it.each(['protagonist.healthText', 'protagonist.emotionText', 'npc[npc_001].healthText', 'npc[npc_001].relationshipText'])(
    '支持%s且只形成唯一执行命令', async (path) => {
      const data = await prepared(`set ${path} = "文本提案"`);
      expect(data.candidate.protocol).toBe('text-v1'); expect(data.candidate.commands).toHaveLength(1);
      expect(data.candidate.instructions).toHaveLength(1); expect(data.candidate.accesses).toHaveLength(1);
      expect(data.committed).toBe(false);
      const r = verifyTextVariableCandidateSync(data.candidate, data.state, data.draft, data.seal);
      expect(r.ok).toBe(true);
    });
  it('保存内容不带thinking、整个回复、正式状态或私人记忆库', async () => {
    const data = fixture(); data.state.npc.npc_001.memories.push({ id: 'private', text: 'PRIVATE-CONTENT', sourceTurnIds: ['old'],
      affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }], visibility: 'npc_private', createdAtGameTime: data.state.worldClock, knowledgeSource: '私人来源' });
    const request = unwrap(captureTextVariableRequestBasis(data.state, data.draft));
    const p = unwrap(await prepareTextVariableCandidate(text, data.state, data.draft, request));
    expect(JSON.stringify(p)).not.toMatch(/不应进入候选|thinking|PRIVATE-CONTENT|"memories"|"journal"|preview_only:audit_not_fact/);
    expect(p.candidate).not.toHaveProperty('state'); expect(p.candidate).not.toHaveProperty('context');
    expect(p.candidate).not.toHaveProperty('rawResponse'); expect(p.committed).toBe(false);
  });
  it.each(['legacy_json', 'preview_only', 'text-v2'])('协议%s拒绝', async (protocol) => {
    const d = await prepared(), { TextVariableCandidateSchema } = await import('../candidates/variableText');
    expect(TextVariableCandidateSchema.safeParse({ ...d.candidate, protocol }).success).toBe(false);
  });
  it.each(['committed', 'validated', 'submitted'])('不能自称状态%s', async (status) => {
    const d = await prepared(); expectCode(verifyTextVariableCandidateSync({ ...d.candidate, status }, d.state, d.draft, d.seal), 'invalid_candidate');
  });
  it.each(['validation', 'thinking', 'fullState', 'preview_only', 'expense', 'memorySource', 'committed'])(
    '额外字段%s拒绝', async (field) => {
      const d = await prepared(); expectCode(verifyTextVariableCandidateSync({ ...d.candidate, [field]: true }, d.state, d.draft, d.seal), 'invalid_candidate');
    });
  it('3A预演DTO与旧JSON结果都不能成为新候选', async () => {
    const { captureVariableTextPreviewBasis, previewVariableTextReply } = await import('../bridges/variableText');
    const d = await prepared(), basis = unwrap(await captureVariableTextPreviewBasis(d.state, d.draft));
    const preview = await previewVariableTextReply(text, d.state, d.draft, basis);
    expectCode(verifyTextVariableCandidateSync(preview, d.state, d.draft, d.seal), 'invalid_candidate');
    expectCode(verifyTextVariableCandidateSync({ commands: [], rejectedSuggestions: [], unresolved: [] }, d.state, d.draft, d.seal), 'invalid_candidate');
  });
  it('离场、缺地点及不存在NPC均拒绝，不授予interaction', async () => {
    for (const mode of ['offscreen', 'missing-location', 'absent']) {
      const data = fixture(); if (mode === 'offscreen') data.state.npc.npc_001.onScene = false;
      if (mode === 'missing-location') delete data.state.npc.npc_001.locationId;
      if (mode === 'absent') delete data.state.npc.npc_001;
      const basis = unwrap(captureTextVariableRequestBasis(data.state, data.draft));
      const result = await prepareTextVariableCandidate(block('set npc[npc_001].healthText = "健康"'), data.state, data.draft, basis);
      expectCode(result, mode === 'absent' ? 'entity_not_found' : 'permission_denied');
    }
  });
  it('地点不一致违反原Schema，不能靠授权字段绕过', () => {
    const data = fixture(); data.state.locations.remote = { id: 'remote', name: '远处' }; data.state.npc.npc_001.locationId = 'remote';
    expectCode(captureTextVariableRequestBasis(data.state, data.draft), 'invalid_state');
  });
  it.each(['set npc[0].healthText = "健康"', 'set npc[npc_001].onScene = true', 'set protagonist.id = "other"', 'set worldClock = "2040-01-01T00:00:00+08:00"'])(
    '未支持路径拒绝：%s', async (body) => {
      const d = fixture(), basis = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
      expectCode(await prepareTextVariableCandidate(block(body), d.state, d.draft, basis), 'unsupported_path');
    });
  it.each(['add economy.cash = -3000', 'add economy.onlineBalance = -3000', 'add items[item_001].quantity = -1',
    'push npc[npc_001].memories = {"text":"我亲眼看到失窃","knowledgeKind":"observed","knowledgeSource":"现场亲历","visibility":"npc_private"}'])(
    'AI自述和variableGuide不能给%s创造事实凭据', async (body) => {
      const d = fixture(); d.draft.story!.variableGuide.push({ group: 'economy', observedFact: '消费已完成，有可信凭据' });
      d.draft.story!.narrative = 'NPC亲眼看到了经过，主角也已经付款。';
      const basis = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
      expectCode(await prepareTextVariableCandidate(block(body), d.state, d.draft, basis), 'missing_provenance');
    });
  it('一条合法后一条无来源，整批准备失败且原对象和AST不变', async () => {
    const d = fixture(), basis = unwrap(captureTextVariableRequestBasis(d.state, d.draft)), before = structuredClone(d);
    const result = await prepareTextVariableCandidate(block('set protagonist.emotionText = "轻松"\nadd economy.cash = -3000'), d.state, d.draft, basis);
    expectCode(result, 'missing_provenance'); expect(d).toEqual(before);
    if (!result.ok) expect(result.error).toMatchObject({ commandIndex: 2, source: { start: { line: 4, column: 1 } } });
  });
});

describe('同步复核不信任存储的标记与摘要', () => {
  it('没有独立封印时拒绝，不能只用候选自己的内容当证明', async () => {
    const d = await prepared();
    const result = Reflect.apply(verifyTextVariableCandidateSync, undefined, [d.candidate, d.state, d.draft]);
    expectCode(result, 'missing_trusted_seal');
  });
  it.each(['value', 'target', 'source', 'commandId', 'expectedRevision', 'npcId', 'extra-field', 'order', 'evidence'])(
    '篡改%s后拒绝', async (field) => {
      const d = await prepared(), changed = structuredClone(d.candidate);
      if (field === 'value') changed.instructions[0].value = '篡改值';
      if (field === 'target') changed.instructions[0].target = { kind: 'protagonist', field: 'healthText' };
      if (field === 'source') changed.instructions[0].source.start.line++;
      if (field === 'commandId') changed.commands[0].commandId = 'other-command';
      if (field === 'expectedRevision' && 'expectedRevision' in changed.commands[0]) changed.commands[0].expectedRevision++;
      if (field === 'npcId' && changed.commands[1].type === 'UpdateNpc') changed.commands[1].npcId = 'missing';
      if (field === 'extra-field' && changed.commands[0].type === 'UpdateProtagonist') changed.commands[0].changes.skills = ['越权技能'];
      if (field === 'order') changed.commands.reverse();
      if (field === 'evidence') changed.commands[0].evidence = 'preview_only:audit_not_fact:fake';
      expectCode(verifyTextVariableCandidateSync(changed, d.state, d.draft, d.seal), 'candidate_tampered');
    });
  it.each(['commands', 'instructions', 'accesses', 'clock', 'coverage'] as const)('自算摘要不能为非法%s背书', async (field) => {
    const d = await prepared(), candidate = structuredClone(d.candidate);
    if (field === 'commands') candidate.commands[0] = { type: 'SpendFunds', commandId: 'text-v1:s1:c1', amount: 3000, purpose: '伪造', evidence: '伪造', account: 'cash' };
    if (field === 'instructions') candidate.instructions[0].value = '改过的源，但未改命令';
    if (field === 'accesses' && candidate.accesses[1].kind === 'npc_scene_text_access') candidate.accesses[1].identityKey = '伪造身份';
    if (field === 'clock') candidate.clock = { kind: 'established', worldClock: '2040-01-01T00:00:00+08:00' };
    if (field === 'coverage') candidate.coverage.representedDomains.push('economy');
    const { sealValue } = await import('../candidates/variableText/hash');
    const fakeSeal = { ...d.seal, payloadDigest: sealValue(candidate) };
    expectCode(verifyTextVariableCandidateSync(candidate, d.state, d.draft, fakeSeal), 'candidate_tampered');
  });
  it('只看合法Schema也不放行改金额或记忆命令', async () => {
    const d = await prepared(), candidate = structuredClone(d.candidate), { sealValue } = await import('../candidates/variableText/hash');
    candidate.commands[0] = { type: 'SpendFunds', commandId: 'text-v1:s1:c1', evidence: 'AI说已支付', account: 'cash', amount: 1, purpose: '消费' };
    const { TextVariableCandidateSchema } = await import('../candidates/variableText'); expect(TextVariableCandidateSchema.safeParse(candidate).success).toBe(true);
    expectCode(verifyTextVariableCandidateSync(candidate, d.state, d.draft, { ...d.seal, payloadDigest: sealValue(candidate) }), 'candidate_tampered');
  });
  it.each(['expense', 'memorySource', 'interaction', 'preview-audit'])(
    '伪造来源%s拒绝', async (kind) => {
      const d = await prepared(), candidate = { ...d.candidate, accesses: [{ ...d.candidate.accesses[0], kind }] };
      expectCode(verifyTextVariableCandidateSync(candidate, d.state, d.draft, d.seal), 'invalid_candidate');
    });
  it('篡改多个一致字段仍不能冒充原准备输出', async () => {
    const d = await prepared(), candidate = structuredClone(d.candidate);
    candidate.instructions[0].value = '另一个提案';
    if (candidate.commands[0].type === 'UpdateProtagonist') candidate.commands[0].changes.emotionText = '另一个提案';
    expectCode(verifyTextVariableCandidateSync(candidate, d.state, d.draft, d.seal), 'candidate_tampered');
  });
  it('当前正式revision、NPC身份或状态变化拒绝旧候选', async () => {
    const d = await prepared();
    for (const mode of ['revision', 'identity', 'offscreen', 'location']) {
      const state = structuredClone(d.state);
      if (mode === 'revision') state.revision++;
      if (mode === 'identity') state.npc.npc_001.identityKey = '另一身份';
      if (mode === 'offscreen') state.npc.npc_001.onScene = false;
      if (mode === 'location') { state.npc.npc_001.onScene = false; delete state.npc.npc_001.locationId; }
      expectCode(verifyTextVariableCandidateSync(d.candidate, state, d.draft, d.seal), 'revision_conflict');
    }
  });
  it('即使自造新状态摘要和封印，离场NPC仍不能获取访问资格', async () => {
    const d = await prepared(), state = structuredClone(d.state), candidate = structuredClone(d.candidate);
    state.npc.npc_001.onScene = false;
    const { sealValue } = await import('../candidates/variableText/hash'); candidate.request.stateDigest = sealValue(state);
    const seal = { ...d.seal, requestDigest: sealValue(candidate.request), payloadDigest: sealValue(candidate) };
    expectCode(verifyTextVariableCandidateSync(candidate, state, d.draft, seal), 'permission_denied');
  });
  it('候选和输入被冻结也可复核，失败不修改任何状态', async () => {
    const d = await prepared(), before = structuredClone(d);
    function freeze(v: unknown) { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } }
    freeze(d); expect(verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal).ok).toBe(true); expect(d).toEqual(before);
  });
});

describe('请求基线、版本与世界专属尝试', () => {
  it('不同存档、回合、正式版本不能复用请求基线', async () => {
    const d = fixture(), basis = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    for (const kind of ['save', 'turn', 'revision']) {
      const state = structuredClone(d.state), draft = structuredClone(d.draft);
      if (kind === 'save') { state.saveId = 'other'; draft.saveId = 'other'; }
      if (kind === 'turn') draft.turnId = 'other-turn';
      if (kind === 'revision') { state.revision = 1; draft.baseSaveRevision = 1; }
      expectCode(await prepareTextVariableCandidate(text, state, draft, basis), 'revision_conflict');
    }
  });
  it('重Roll、篡改正文但不升版本，均不能沿用旧基线或候选', async () => {
    const d = await prepared();
    for (const draft of [rerollStory(d.draft, { ...story, turnKind: 'opening', narrative: '新正文' }),
      { ...d.draft, story: { ...d.draft.story!, narrative: '悄然改写' } }]) {
      expectCode(await prepareTextVariableCandidate(text, d.state, draft, d.request), 'revision_conflict');
      expectCode(verifyTextVariableCandidateSync(d.candidate, d.state, draft, d.seal), 'revision_conflict');
    }
  });
  it('变量补算更新requestRevision后旧候选失效，candidateRevision按新请求递增', async () => {
    const { startStageAttempt } = await import('../domain/drafts'), d = await prepared();
    const draft = startStageAttempt(d.draft, ['variables']);
    expectCode(verifyTextVariableCandidateSync(d.candidate, d.state, draft, d.seal), 'revision_conflict');
    const next = await prepared('set protagonist.emotionText = "新情绪"', { state: d.state, draft });
    expect(next.candidate.candidateRevision).toBe(draft.stageRequestRevisions.variables + 1);
    expect(next.candidate.candidateRevision).toBeGreaterThan(d.candidate.candidateRevision);
  });
  it('任意更改executionRevision，不能借口draftRevision递增而通过', async () => {
    const d = await prepared(), draft = { ...d.draft, executionRevision: d.draft.executionRevision + 1, draftRevision: d.draft.draftRevision + 1 };
    expectCode(verifyTextVariableCandidateSync(d.candidate, d.state, draft, d.seal), 'revision_conflict');
  });
  it('合法保存后的draftRevision增量通过，不要求永远等于请求出生版本', async () => {
    const d = await prepared();
    for (const increment of [1, 2, 9]) {
      const draft = { ...d.draft, draftRevision: d.draft.draftRevision + increment };
      expect(verifyTextVariableCandidateSync(d.candidate, d.state, draft, d.seal).ok).toBe(true);
    }
  });
  it('world专属执行合法推进全局execution，但变量请求身份未变时仍可复用', async () => {
    const { startStageAttempt } = await import('../domain/drafts'), d = await prepared();
    const world = startStageAttempt(d.draft, ['world']);
    expect(world.executionRevision).toBeGreaterThan(d.candidate.request.executionRevision);
    expect(world.stageRequestRevisions.variables).toBe(d.candidate.request.requestRevision);
    expect(verifyTextVariableCandidateSync(d.candidate, d.state, world, d.seal).ok).toBe(true);
    const retry = startStageAttempt(world, ['world']);
    expect(verifyTextVariableCandidateSync(d.candidate, d.state, retry, d.seal).ok).toBe(true);
  });
  it('候选出生版本之前的草稿拒绝', async () => {
    const d = await prepared(); expectCode(verifyTextVariableCandidateSync(d.candidate, d.state, { ...d.draft, draftRevision: 0 }, d.seal), 'revision_conflict');
  });
  it('候选revision及变量requestRevision不能自己重写', async () => {
    const d = await prepared();
    expectCode(verifyTextVariableCandidateSync({ ...d.candidate, candidateRevision: 99 }, d.state, d.draft, d.seal), 'revision_conflict');
    expectCode(verifyTextVariableCandidateSync({ ...d.candidate, request: { ...d.candidate.request, requestRevision: 99 } }, d.state, d.draft, d.seal), 'revision_conflict');
  });
  it('prepare期间修改正式状态或草稿，拒绝异步迟到结果', async () => {
    const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    const pending = prepareTextVariableCandidate(text, d.state, d.draft, request); d.draft.draftRevision++;
    expectCode(await pending, 'revision_conflict');
    const now = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    const second = prepareTextVariableCandidate(text, d.state, d.draft, now); d.state.protagonist.emotionText = '当前已变化';
    expectCode(await second, 'revision_conflict');
  });
  it('正文未ready、阶段关闭、已提交turn不准备候选', async () => {
    const d = fixture(); expectCode(captureTextVariableRequestBasis(d.state, { ...d.draft, stageStatus: { ...d.draft.stageStatus, story: 'failed' } }), 'story_not_ready');
    const disabled = rerollStory(createTurnDraft(d.state.saveId, 0, 'disabled', 'opening', '', false), { ...story, turnKind: 'opening' });
    expectCode(captureTextVariableRequestBasis(d.state, disabled), 'permission_denied');
    d.state.revision = 1; d.state.turnNumber = 1; d.state.journal = [{ turnId: d.draft.turnId, revision: 1, story, relatedActorRefs: [] }];
    const draft = rerollStory(createTurnDraft(d.state.saveId, 1, d.draft.turnId, 'regular', ''), story);
    expectCode(captureTextVariableRequestBasis(d.state, draft), 'revision_conflict');
  });
});

describe('开局时钟与同步事务', () => {
  async function opening() {
    const { pendingOpeningClock } = await import('../domain/openingTime');
    const d = fixture(); d.state.worldClock = pendingOpeningClock; d.state.openingTimePending = true;
    d.draft.story!.variableGuide.push({ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:05:00+08:00' }) });
    return prepared('set protagonist.healthText = "疲倦"', d);
  }
  it('程序时钟与AI命令分离，统一投影只注入一次', async () => {
    const d = await opening(), { variableCommandsForTurn } = await import('../domain/turnProjection');
    const { openingTimeBase } = await import('../domain/openingTime'), { commitCommands } = await import('../domain/commands');
    expect(d.candidate.commands.some((c) => c.type === 'SetWorldClock')).toBe(false);
    expect(d.candidate.clock).toEqual({ kind: 'opening_story', storyRevision: 1, startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:05:00+08:00' });
    const checked = unwrap(verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal));
    const commands = variableCommandsForTurn(d.state, d.draft, checked.commands);
    expect(commands.filter((c) => c.type === 'SetWorldClock')).toHaveLength(1);
    const simulated = commitCommands(openingTimeBase(d.state, d.draft), d.draft.turnId, 0, commands, d.state.updatedAt);
    expect(simulated.worldClock).toBe('2015-06-01T08:05:00+08:00'); expect(d.state.openingTimePending).toBe(true);
    expect(commitCommands(simulated, d.draft.turnId, 0, commands, d.state.updatedAt)).toEqual(simulated);
  });
  it('注入、重复或修改program clock即使自算封印也被拒绝', async () => {
    const d = await opening(), { sealValue } = await import('../candidates/variableText/hash');
    for (const kind of ['append', 'duplicate', 'metadata']) {
      const candidate = structuredClone(d.candidate);
      if (kind === 'metadata' && candidate.clock.kind === 'opening_story') candidate.clock.endAt = '2015-06-02T00:00:00+08:00';
      else {
        const clock = { type: 'SetWorldClock' as const, commandId: 'opening-clock:1', evidence: 'Story结构化开局时间', worldClock: '2015-06-01T08:05:00+08:00' };
        candidate.commands.push(clock); if (kind === 'duplicate') candidate.commands.push(clock);
      }
      expectCode(verifyTextVariableCandidateSync(candidate, d.state, d.draft, { ...d.seal, payloadDigest: sealValue(candidate) }), 'candidate_tampered');
    }
  });
  it('待定开局缺时间来源明确失败，不使用占位时钟', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime'), d = fixture();
    d.state.openingTimePending = true; d.state.worldClock = pendingOpeningClock;
    const request = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    expectCode(await prepareTextVariableCandidate(text, d.state, d.draft, request), 'time_data');
  });
  it('原纯历史视角只读边界没有放松', async () => {
    const d = fixture(); d.state.turnNumber = 1; d.state.revision = 1; d.state.journal.push({ turnId: 'old', revision: 1, story, relatedActorRefs: [] });
    d.draft = rerollStory(createTurnDraft(d.state.saveId, 1, 'historical', 'regular', '切换到同事的视角，回顾昨天的事情。'), { ...story,
      variableGuide: [{ group: 'time', subjectHint: 'time:retrospective', observedFact: JSON.stringify({ npcId: 'npc_001', perspectiveRequest: '切换到同事的视角', pastRequest: '回顾昨天的事情', temporalScope: 'past_only', currentPlotAdvances: false }) }] });
    const request = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    expectCode(await prepareTextVariableCandidate(block('set protagonist.emotionText = "现在改变"'), d.state, d.draft, request), 'time_data');
  });
  it('同步复核不用WebCrypto、异步编译或模拟器，并返回非Promise', async () => {
    const d = await prepared(), { vi } = await import('vitest'), executor = await import('../executors/variableText');
    const digest = vi.spyOn(crypto.subtle, 'digest'), compile = vi.spyOn(executor, 'compileVariableCommands'), simulate = vi.spyOn(executor, 'simulateVariablePlan');
    try {
      const result = verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal);
      expect(result).not.toBeInstanceOf(Promise); expect(result.ok).toBe(true);
      expect(digest).not.toHaveBeenCalled(); expect(compile).not.toHaveBeenCalled(); expect(simulate).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); compile.mockRestore(); simulate.mockRestore(); }
  });
  it('真实IDB读写事务的onsuccess内同步复核后仍可写，不等待非IDB任务', async () => {
    const d = await prepared(), { IDBFactory } = await import('fake-indexeddb'), { GameStateSchema } = await import('../domain/state'), factory = new IDBFactory();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('candidate-sync-test', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction('records', 'readwrite'), store = tx.objectStore('records');
        store.put(d.state, 'state');
        const read = store.get('state');
        read.onsuccess = () => {
          // 不把异步verify塞进这里；从当前IDB读取结果同步复核。
          const current = GameStateSchema.parse(read.result);
          const result = verifyTextVariableCandidateSync(d.candidate, current, d.draft, d.seal);
          expect(result.ok).toBe(true); store.put(result.ok ? result.value.commands : [], 'verified');
        };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { database.close(); }
  });
});

describe('覆盖范围不能伪装完整成功', () => {
  it.each(['economy', 'items', 'organization', 'event', 'time'] as const)('遗漏%s提示时标记unsupported_hints而非完整覆盖', async (group) => {
    const d = fixture(); d.draft.story!.variableGuide.push({ group, observedFact: '发生了待处理的重要变化' });
    const p = await prepared('set protagonist.emotionText = "平静"', d);
    expect(p.candidate.coverage).toMatchObject({ complete: false, status: 'unsupported_hints', unsupportedGuideIndices: [0] });
    const result = unwrap(verifyTextVariableCandidateSync(p.candidate, d.state, d.draft, p.seal)); expect(result.commitAllowed).toBe(false);
  });
  it('只有主角/NPC提示也不能证明没有未覆盖技能、身份或知识变化', async () => {
    const d = fixture(); d.draft.story!.variableGuide.push({ group: 'npc', observedFact: 'NPC有所变化' });
    const p = await prepared('set protagonist.emotionText = "平静"', d);
    expect(p.candidate.coverage).toMatchObject({ complete: false, status: 'scope_unconfirmed' });
  });
  it('空命令是可模拟的空提案，但不声称业务无修改已经确认', async () => {
    const d = await prepared(''); expect(d.candidate.commands).toEqual([]); expect(d.candidate.coverage).toMatchObject({ status: 'empty_unconfirmed', complete: false });
    const checked = unwrap(verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal)); expect(checked.commitAllowed).toBe(false);
  });
  it('没有AI指导不代表整篇小说无其他变量；规则模块加载不等于业务事实覆盖', async () => {
    const d = await prepared(); expect(d.candidate.coverage.ruleDomains).toHaveLength(9);
    expect(d.candidate.coverage.representedDomains).toEqual(['protagonist', 'npc_ordinary']);
    expect(d.candidate.coverage.complete).toBe(false);
  });
  it('不得伪造coverage.complete或complete状态', async () => {
    const d = await prepared();
    expectCode(verifyTextVariableCandidateSync({ ...d.candidate, coverage: { ...d.candidate.coverage, complete: true } }, d.state, d.draft, d.seal), 'invalid_candidate');
  });
});

describe('同步摘要、确定性和旧引擎隔离', () => {
  it.each(['', 'abc', '中文与Unicode😀', 'a'.repeat(1000)])('同步SHA-256与平台实现一致', async (value) => {
    const { sealValue } = await import('../candidates/variableText/hash'), { fingerprint } = await import('../domain/commands');
    const { createHash } = await import('node:crypto');
    expect(sealValue(value)).toBe(createHash('sha256').update(fingerprint(value)).digest('hex'));
  });
  it('同输入、同请求生成相同候选和封印，不修改输入或标准AST', async () => {
    const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft)), before = structuredClone(d);
    const a = unwrap(await prepareTextVariableCandidate(text, d.state, d.draft, request));
    const b = unwrap(await prepareTextVariableCandidate(text, d.state, d.draft, request)); expect(a).toEqual(b); expect(d).toEqual(before);
  });
  it('复核命令仍保持原commitCommands精确重放，不重复生成资源', async () => {
    const d = await prepared(), { commitCommands } = await import('../domain/commands');
    const commands = unwrap(verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal)).commands;
    const first = commitCommands(d.state, d.draft.turnId, 0, commands, d.state.updatedAt);
    expect(commitCommands(first, d.draft.turnId, 0, commands, d.state.updatedAt)).toEqual(first);
    expect(d.state.revision).toBe(0); expect(first.npc.npc_001.memories).toEqual([]);
  });
  it('准备和复核没有网络、数据库或AI调用', async () => {
    const { vi } = await import('vitest'), { AiClient } = await import('../services/ai/client');
    const fetch = vi.fn(), indexedDB = { open: vi.fn() }, generate = vi.spyOn(AiClient.prototype, 'generate');
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('indexedDB', indexedDB);
    try { const d = await prepared(); expect(verifyTextVariableCandidateSync(d.candidate, d.state, d.draft, d.seal).ok).toBe(true);
      expect(fetch).not.toHaveBeenCalled(); expect(indexedDB.open).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    } finally { generate.mockRestore(); vi.unstubAllGlobals(); }
  });
  it('安全失败不带原始回复、私人记忆或错误字段值', async () => {
    const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    const r = await prepareTextVariableCandidate(block('set npc[PRIVATE-ID].healthText = "SECRET-CONTENT"'), d.state, d.draft, request);
    expectCode(r, 'entity_not_found'); expect(JSON.stringify(r)).not.toMatch(/PRIVATE-ID|SECRET-CONTENT/);
  });
});

describe('准备失败与原始解析来源', () => {
  it('原始AST被冻结仍可准备，原指令与输入不变', async () => {
    const { vi } = await import('vitest'), parser = await import('../parsers/variableText');
    const ast = unwrap(parser.parseVariableText(text)), copy = structuredClone(ast);
    function freeze(v: unknown) { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } }
    freeze(ast); const parse = vi.spyOn(parser, 'parseVariableText').mockReturnValue({ ok: true, value: ast });
    try {
      const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft)), before = structuredClone(d);
      expect((await prepareTextVariableCandidate(text, d.state, d.draft, request)).ok).toBe(true);
      expect(ast).toEqual(copy); expect(d).toEqual(before);
    } finally { parse.mockRestore(); }
  });
  it('解析错误保留来源与阶段，不回显坏JSON', async () => {
    const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft));
    const result = await prepareTextVariableCandidate(block('set protagonist.healthText = {"private":"SECRET",}'), d.state, d.draft, request);
    expectCode(result, 'json_value'); if (!result.ok) expect(result).toMatchObject({ failedAt: 'parsing', origin: 'parser', error: { commandIndex: 1, position: { line: 3 } } });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('模拟阶段失败不能提前形成prepared候选', async () => {
    const { vi } = await import('vitest'), executor = await import('../executors/variableText'), { failed } = await import('../executors/variableText/model');
    const simulate = vi.spyOn(executor, 'simulateVariablePlan').mockResolvedValue(failed('transaction_failed'));
    try {
      const d = fixture(), request = unwrap(captureTextVariableRequestBasis(d.state, d.draft)), before = structuredClone(d);
      const result = await prepareTextVariableCandidate(text, d.state, d.draft, request);
      expectCode(result, 'transaction_failed'); if (!result.ok) expect(result.failedAt).toBe('simulation'); expect(d).toEqual(before);
    } finally { simulate.mockRestore(); }
  });
});

describe('变量请求生命周期门禁', () => {
  it('world专属尝试不允许捕获新变量请求，但已有变量候选仍可同步复用', async () => {
    const d = await prepared(), { startStageAttempt } = await import('../domain/drafts'), world = startStageAttempt(d.draft, ['world']);
    expectCode(captureTextVariableRequestBasis(d.state, world), 'permission_denied');
    expect(verifyTextVariableCandidateSync(d.candidate, d.state, world, d.seal).ok).toBe(true);
  });
  it('直接伪造当前world请求基线也不能准备新的变量候选', async () => {
    const d = fixture(), { startStageAttempt } = await import('../domain/drafts'), { requestBasisFor } = await import('../candidates/variableText/basis');
    const world = startStageAttempt(d.draft, ['world']);
    expectCode(await prepareTextVariableCandidate(text, d.state, world, requestBasisFor(d.state, world)), 'permission_denied');
  });
  it('失败阶段必须先创建新的变量尝试，不能直接捕获沿用旧请求', () => {
    const d = fixture(); d.draft.stageStatus.variables = 'failed';
    expectCode(captureTextVariableRequestBasis(d.state, d.draft), 'permission_denied');
  });
  it.each(['failed', 'skipped'] as const)('当前变量状态%s不能复核为可投影的当前候选', async (status) => {
    const d = await prepared(), draft = structuredClone(d.draft); draft.stageStatus.variables = status;
    if (status === 'skipped') draft.useVariableStage = false;
    expectCode(verifyTextVariableCandidateSync(d.candidate, d.state, draft, d.seal), 'revision_conflict');
  });
});
