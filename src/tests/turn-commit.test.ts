import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { GameStateSchema } from '../domain/state';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { commitCommands } from '../domain/commands';
import { completeDraft, submission } from './fixtures/turn';
import { worldState, worldResult, npcUpdate, proof } from './fixtures/world';
import { gameTime, task, event, purchase, npc } from './fixtures/game';
import { reserveStageSession } from '../workflows/stageGuard';

let repo: SaveRepository, factory: IDBFactory;
const emptyVariables = () => ({ commands: [], rejectedSuggestions: [], unresolved: [] });
beforeEach(async () => {
  factory = new IDBFactory();
  repo = await SaveRepository.open('commit', factory);
  await repo.create(worldState());
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.close();
});
async function unchanged(input: Parameters<SaveRepository['commitTurn']>[0]) {
  const before = await repo.loadGame('save-a');
  await expect(repo.commitTurn(input)).rejects.toThrow();
  expect(await repo.loadGame('save-a')).toEqual(before);
}

describe('真实 Repository → 候选重验 → 单事务正式结算', () => {
  it('开局正式扣款、时间、场外 NPC 生效，完整正文与下一输入一起保存', async () => {
    const draft = await completeDraft(repo, { world: worldResult([npcUpdate()]) });
    const result = await repo.commitTurn(submission(draft));
    expect(result.state).toMatchObject({
      revision: 1,
      turnNumber: 1,
      worldClock: '2026-10-18T08:10:00+08:00',
      economy: { cash: 7000 },
      npc: { 'npc-a': { healthText: '稍感疲倦' } },
    });
    expect(result.state.journal).toEqual([
      { turnId: draft.turnId, revision: 1, story: draft.story, relatedActorRefs: [] },
    ]);
    expect(result.state.appliedCommands).toHaveLength(3);
    expect(result.draft).toMatchObject({
      baseSaveRevision: 1,
      turnKind: 'regular',
      userInput: '去社区诊所咨询',
      draftRevision: 0,
      storyRevision: 0,
    });
    expect(result.replayed).toBe(false);
    expect(await repo.loadGame('save-a')).toEqual({ state: result.state, draft: result.draft });
    expect(GameStateSchema.safeParse(result.state).success).toBe(true);
  });
  it('十个连续开局/普通空命令回合，各递增一次，正文与摘要永久保留', async () => {
    for (let index = 1; index <= 10; index++) {
      const draft = await completeDraft(repo, {
        variables: emptyVariables(),
        narrative: `主角坐在公园休息，第${index}幕。`,
      });
      const result = await repo.commitTurn(submission(draft, `第${index + 1}幕行动`));
      expect(result.state.revision).toBe(index);
      expect(result.state.turnNumber).toBe(index);
      expect(result.state.journal).toHaveLength(index);
      expect(result.state.journal.at(-1)?.revision).toBe(index);
      expect(result.state.journal.at(-1)?.story.turnKind).toBe(index === 1 ? 'opening' : 'regular');
      expect(result.state.journal.at(-1)?.story.summary).toBe('已完成用餐');
      expect(result.state.appliedCommands).toEqual([]);
      expect(result.state.worldClock).toBe(gameTime);
    }
  });
  it('保持旧 commitCommands 的空命令与幂等契约', () => {
    const state = worldState();
    expect(commitCommands(state, 'old-turn', 0, [])).toEqual(state);
    const next = commitCommands(state, 'old-turn', 0, [purchase()]);
    expect(commitCommands(next, 'old-turn', 0, [purchase()])).toEqual(next);
  });
  it('物品获得和装备作为一个候选整批正式生效', async () => {
    const fact = '主角已经用现金支付25元购买上衣，并穿上上衣。';
    const buy = { ...purchase(), evidence: fact };
    const draft = await completeDraft(repo, {
      narrative: fact,
      variables: {
        ...emptyVariables(),
        commands: [
          buy,
          {
            type: 'SetEquipment',
            commandId: 'wear',
            evidence: fact,
            equipment: { topItemId: 'shirt', accessoryItemIds: [] },
          },
        ],
      },
    });
    const result = await repo.commitTurn(submission(draft));
    expect(result.state.economy.cash).toBe(7500);
    expect(result.state.items.shirt.ownerRef).toEqual({ kind: 'protagonist', id: 'hero' });
    expect(result.state.protagonist.currentWear.topItemId).toBe('shirt');
  });
  it('futureEvents 只镜像一份实体；合法 NPC 任务与隐藏事件正式延续但不公开 hooks', async () => {
    const job = {
      ...task(),
      actorRef: { kind: 'npc' as const, id: 'npc-a' },
      startAt: '2026-10-18T09:00:00+08:00',
      dueAt: '2026-10-18T10:00:00+08:00',
    };
    const future = {
      ...event(),
      actorRefs: [job.actorRef],
      startAt: job.startAt,
      estimatedEndAt: job.dueAt,
    };
    const evidence = proof({ kind: 'planned', fact: '同事计划整理诊室。' });
    const world = {
      ...worldResult(),
      taskCommands: [{ type: 'SaveTask' as const, commandId: 'job', evidence, task: job }],
      eventCommands: [{ type: 'SaveEvent' as const, commandId: 'future', evidence, event: future }],
      futureEvents: [future],
    };
    const draft = await completeDraft(repo, { world });
    // 事件来源使用本回合真实 ID。
    future.sourceTurnIds = [draft.turnId];
    // 新建另一草稿版本以模拟经过正式阶段保存的输出，而非提交时偷偷改 props。
    const stored = await repo.saveDraft(
      {
        ...draft,
        draftRevision: draft.draftRevision + 1,
        world: { ...draft.world!, candidateRevision: 2, result: world },
      },
      draft.draftRevision,
    );
    const result = await repo.commitTurn(submission(stored));
    expect(Object.keys(result.state.events)).toEqual(['event-a']);
    expect(result.state.tasks['task-a'].actorRef.id).toBe('npc-a');
    expect(result.state.timeline).toEqual([]);
    expect(JSON.stringify(result.state.journal)).not.toContain('内部候选线索');
    expect(JSON.stringify(result.state)).not.toContain('财务与物品经营变化尚无场外授权');
  });
  it('特殊初始同伴身份、目标及引用在开局提交后保留', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.initialCompanionId = 'npc-a';
    await repo.create(state);
    const draft = await completeDraft(repo);
    const result = await repo.commitTurn(submission(draft));
    expect(result.state.initialCompanionId).toBe('npc-a');
    expect(result.state.npc['npc-a']).toEqual(state.npc['npc-a']);
  });
  it('新现场 NPC 正式建档并幂等重试，不重复创建或覆盖同伴', async () => {
    const evidence = '周霖已经来到重庆并与主角会面。';
    const draft = await completeDraft(repo, {
      narrative: evidence,
      variables: {
        ...emptyVariables(),
        commands: [
          {
            type: 'CreateNpc',
            commandId: 'create-zhou',
            evidence,
            npc: { ...npc('zhou'), name: '周霖', affinity: 0, relationshipText: '初次会面' },
          },
        ],
      },
    });
    const first = await repo.commitTurn(submission(draft));
    const replay = await repo.commitTurn(submission(draft));
    expect(replay.state.npc).toEqual(first.state.npc);
    expect(replay.state.npc.zhou.name).toBe('周霖');
    expect(replay.state.appliedCommands).toHaveLength(1);
  });
  it.each(['world', 'variables', 'story'] as const)('%s 未 ready 不得部分结算', async (stage) => {
    const draft = await completeDraft(repo);
    const partial = { ...draft, stageStatus: { ...draft.stageStatus, [stage]: 'pending' } };
    await unchanged(submission(partial));
  });
  it('关闭阶段但复用候选也不能冒充完整提交', async () => {
    const draft = await completeDraft(repo);
    const changed = await repo.saveDraft(
      {
        ...draft,
        draftRevision: draft.draftRevision + 1,
        executionRevision: 1,
        requestedStages: ['world'],
        stageRequestRevisions: { variables: 0, world: 1 },
        useVariableStage: false,
        world: undefined,
        stageStatus: { ...draft.stageStatus, world: 'pending' },
      },
      draft.draftRevision,
    );
    await unchanged(submission(changed));
  });
  it('世界 preview 不得提交，错误变量依赖版本亦拒绝', async () => {
    const draft = await completeDraft(repo);
    const preview = await repo.saveDraft(
      {
        ...draft,
        draftRevision: draft.draftRevision + 1,
        world: { ...draft.world!, candidateRevision: 2, validation: 'preview' },
        stageStatus: { ...draft.stageStatus, world: 'preview' },
      },
      draft.draftRevision,
    );
    await unchanged(submission(preview));
    await unchanged(
      submission({ ...preview, world: { ...preview.world!, basedOnVariableRevision: 999 } }),
    );
  });
  it.each(['story', 'amount', 'nextAction', 'flags'] as const)(
    '重复提交 %s 内容不同安全拒绝',
    async (change) => {
      const draft = await completeDraft(repo),
        request = submission(draft);
      await repo.commitTurn(request);
      const changed = structuredClone(request);
      if (change === 'story') changed.draft.story!.narrative += '不同结局';
      if (change === 'amount') changed.draft.variables!.result.commands = [];
      if (change === 'nextAction') changed.nextAction = '另一行动';
      if (change === 'flags') changed.useWorldStage = false;
      await unchanged(changed);
    },
  );
  it('成功后相同请求重复到达只读取回执，不重复扣款或创建下一草稿', async () => {
    const draft = await completeDraft(repo),
      input = submission(draft);
    const first = await repo.commitTurn(input),
      retry = await repo.commitTurn(input);
    expect(retry).toEqual({ ...first, replayed: true });
    const secondDraft = await completeDraft(repo, { variables: emptyVariables() });
    await repo.commitTurn(submission(secondDraft));
    const later = await repo.commitTurn(input);
    expect(later.state.turnNumber).toBe(2);
    expect(later.draft.baseSaveRevision).toBe(2);
    expect(later.replayed).toBe(true);
  });
  it('同页双击和第二连接并发只能产生一个正文条目', async () => {
    const draft = await completeDraft(repo),
      input = submission(draft);
    const second = await SaveRepository.open('commit', factory);
    try {
      const results = await Promise.allSettled([repo.commitTurn(input), second.commitTurn(input)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await repo.loadGame('save-a')).state.turnNumber).toBe(1);
      expect((await repo.load('save-a')).economy.cash).toBe(7000);
    } finally {
      second.close();
    }
  });
  it('工作流运行及阶段衔接期间 Repository 也拒绝提交', async () => {
    const draft = await completeDraft(repo),
      session = reserveStageSession('save-a');
    try {
      await unchanged(submission(draft));
    } finally {
      session.release();
    }
  });
  it('其他标签 Roll 或正式版本变化不能提交旧候选', async () => {
    const draft = await completeDraft(repo);
    await repo.saveDraft(
      rerollStory(draft, { ...draft.story!, narrative: '新正文' }),
      draft.draftRevision,
    );
    await unchanged(submission(draft));
    await repo.save('save-a', 0, 'other', [
      {
        type: 'SetWorldClock',
        commandId: 'clock',
        evidence: '一分钟过去',
        worldClock: '2026-10-18T08:01:00+08:00',
      },
    ]);
    await unchanged(submission(draft));
  });
  it('存档身份、模式与下一输入不合法时拒绝', async () => {
    const draft = await completeDraft(repo);
    await unchanged(
      submission({
        ...draft,
        turnKind: 'regular',
        story: { ...draft.story!, turnKind: 'regular' },
      }),
    );
    await unchanged(submission(draft, '   '));
    await unchanged(submission({ ...draft, saveId: 'missing' }));
  });
  it.each(['drafts', 'turnReceipts', 'abort'] as const)(
    '事务在 %s 写入点失败时，saves/drafts/回执全部回滚',
    async (point) => {
      const draft = await completeDraft(repo);
      const originalPut = IDBObjectStore.prototype.put,
        originalAdd = IDBObjectStore.prototype.add;
      if (point === 'drafts')
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
          this: IDBObjectStore,
          value,
          key,
        ) {
          if (this.name === 'drafts') throw new DOMException('mock quota', 'QuotaExceededError');
          return originalPut.call(this, value, key);
        });
      else
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
          this: IDBObjectStore,
          value,
          key,
        ) {
          if (this.name === 'turnReceipts' && point === 'turnReceipts')
            throw new DOMException('mock quota', 'QuotaExceededError');
          const request = originalAdd.call(this, value, key);
          if (this.name === 'turnReceipts')
            request.addEventListener('success', () => this.transaction.abort());
          return request;
        });
      await unchanged(submission(draft));
      vi.restoreAllMocks();
      const retry = await repo.commitTurn(submission(draft));
      expect(retry.replayed).toBe(false);
      expect(retry.state.turnNumber).toBe(1);
    },
  );
});

describe('最终重验与存储兼容', () => {
  it('变量单独和世界单独合法，重复实体的组合必须整批拒绝', async () => {
    const fact = '社区已有储物间。';
    const location = { id: 'new-place', name: '储物间', parentId: 'chongqing' };
    const variable = {
      type: 'CreateLocation' as const,
      commandId: 'variable-place',
      evidence: fact,
      location,
    };
    const world = {
      ...variable,
      commandId: 'world-place',
      evidence: proof({ kind: 'established', sources: ['story:current'], fact, at: gameTime }),
    };
    const state = await repo.load('save-a');
    expect(commitCommands(state, 'test', 0, [variable]).locations['new-place']).toBeDefined();
    expect(commitCommands(state, 'test', 0, [world]).locations['new-place']).toBeDefined();
    const draft = await completeDraft(repo, {
      narrative: fact,
      variables: { ...emptyVariables(), commands: [variable] },
      world: worldResult([world]),
    });
    await unchanged(submission(draft));
  });
  it('跨阶段重复 commandId 不得执行两次', async () => {
    const draft = await completeDraft(repo, {
      world: worldResult([{ ...npcUpdate(), commandId: 'meal' }]),
    });
    await unchanged(submission(draft));
  });
  it('伪造 validated 的场内/主角世界更新不得提交', async () => {
    const draft = await completeDraft(repo, { world: worldResult([npcUpdate({ onScene: true })]) });
    await unchanged(submission(draft));
  });
  it('世界不能通过别名为同一稳定身份重复建档', async () => {
    const alias = {
      ...npc('npc-a'),
      id: 'new-alias',
      name: '别名',
      onScene: false,
      affinity: 0,
      relationshipText: '尚未与主角接触',
    };
    const draft = await completeDraft(repo, {
      world: worldResult([
        { type: 'CreateNpc', commandId: 'duplicate-person', evidence: proof(), npc: alias },
      ]),
    });
    await unchanged(submission(draft));
  });
  it('开局世界候选仍不能改写初始同伴', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.initialCompanionId = 'npc-a';
    await repo.create(state);
    const draft = await completeDraft(repo, { world: worldResult([npcUpdate()]) });
    await unchanged(submission(draft));
  });
  it('没有肯定终止事实的旧事件取消在正式边界再次拒绝', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.events['event-a'] = {
      ...event(),
      actorRefs: [{ kind: 'npc', id: 'npc-a' }],
      sourceTurnIds: [],
    };
    await repo.create(state);
    const evidence = proof({
      sources: ['event:event-a'],
      fact: '同事整理了资料。',
      outcome: '诊室资料整理妥当',
    });
    const draft = await completeDraft(repo, {
      world: {
        ...worldResult(),
        eventCommands: [
          {
            type: 'SaveEvent',
            commandId: 'cancel',
            evidence,
            event: {
              ...state.events['event-a'],
              status: 'cancelled',
              sourceTurnIds: ['initial-save-a'],
            },
          },
        ],
      },
    });
    await unchanged(submission(draft));
  });
  it('NPC 同批完成 A 又创建 B 不得绕过占用', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.tasks['task-a'] = { ...task(), actorRef: { kind: 'npc', id: 'npc-a' } };
    await repo.create(state);
    const draft = await completeDraft(repo, {
      world: {
        ...worldResult(),
        taskCommands: [
          {
            type: 'SaveTask',
            commandId: 'done',
            evidence: proof({
              sources: ['task:task-a'],
              fact: '同事已经完成预约。',
              outcome: '所有预约资料归档完毕。',
            }),
            task: { ...state.tasks['task-a'], status: 'completed' },
          },
          {
            type: 'SaveTask',
            commandId: 'next',
            evidence: proof({ kind: 'planned' }),
            task: { ...state.tasks['task-a'], id: 'task-b', goal: '新的任务' },
          },
        ],
      },
    });
    await unchanged(submission(draft));
  });
  it('隐藏重大结案事件不能通过 timelineCandidates 自动揭示', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.events.hidden = {
      ...event('hidden'),
      status: 'resolved',
      resolvedAt: gameTime,
      resolutionText: '秘密行动已结束',
      sourceTurnIds: [],
    };
    await repo.create(state);
    const draft = await completeDraft(repo, {
      world: { ...worldResult(), timelineCandidates: ['hidden'] },
    });
    await unchanged(submission(draft));
  });
  it('已知重大结案事件按现有事实归档，futureEvents 不生成第二份实体', async () => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.events.public = {
      ...event('public'),
      status: 'resolved',
      resolvedAt: gameTime,
      resolutionText: '预约已完成',
      visibility: 'known',
      sourceTurnIds: [],
    };
    await repo.create(state);
    const draft = await completeDraft(repo, {
      variables: emptyVariables(),
      world: { ...worldResult(), timelineCandidates: ['public'] },
    });
    const result = await repo.commitTurn(submission(draft));
    expect(result.state.timeline).toEqual([
      {
        eventId: 'public',
        occurredAt: gameTime,
        title: '预约',
        summary: '预约',
        outcome: '预约已完成',
        longTermImpact: '',
        actorRefs: [],
        sourceTurnIds: [],
      },
    ]);
  });
  it('变量产生两个 NPC 任务、世界仅报告旧冲突时，最终仍必须拒绝', async () => {
    const evidence = '现场人物已接下甲任务及乙任务。';
    const commands = ['first', 'second'].map((id) => ({
      type: 'SaveTask' as const,
      commandId: id,
      evidence,
      task: {
        ...task(id),
        actorRef: { kind: 'npc' as const, id: 'scene' },
        goal: id,
        startAt: '2026-10-18T09:00:00+08:00',
        dueAt: '2026-10-18T10:00:00+08:00',
      },
    }));
    const draft = await completeDraft(repo, {
      narrative: evidence,
      variables: { ...emptyVariables(), commands },
    });
    await unchanged(submission(draft));
  });
  it('正文声称未来任务已完成，不能绕过正式时间窗口', async () => {
    const evidence = '主角已完成预约。';
    const draft = await completeDraft(repo, {
      narrative: evidence,
      variables: {
        ...emptyVariables(),
        commands: [
          {
            type: 'SaveTask',
            commandId: 'future-done',
            evidence,
            task: {
              ...task(),
              status: 'completed',
              startAt: '2026-10-19T08:00:00+08:00',
              dueAt: '2026-10-19T09:00:00+08:00',
            },
          },
        ],
      },
    });
    await unchanged(submission(draft));
  });
  it.each([true, false])('现场终止绑定原目标，不要求正文展示后台 ID：绑定=%s', async (bound) => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.tasks.future = {
      ...task('future'),
      goal: '预约安排',
      startAt: '2026-10-19T08:00:00+08:00',
      dueAt: '2026-10-19T09:00:00+08:00',
    };
    await repo.create(state);
    const evidence = bound ? '因诊所关闭，主角的预约安排已终止。' : '主角的其他安排已终止。';
    const draft = await completeDraft(repo, {
      narrative: evidence,
      variables: {
        ...emptyVariables(),
        commands: [
          {
            type: 'SaveTask',
            commandId: 'stop',
            evidence,
            task: { ...state.tasks.future, status: 'cancelled' },
          },
        ],
      },
    });
    if (!bound) await unchanged(submission(draft));
    else
      expect((await repo.commitTurn(submission(draft))).state.tasks.future.status).toBe(
        'cancelled',
      );
  });
  it.each([true, false])('现场任务完成必须关联同一目标：绑定=%s', async (bound) => {
    await repo.delete('save-a', 0);
    const state = worldState();
    state.tasks.appointment = { ...task('appointment'), goal: '预约' };
    await repo.create(state);
    const evidence = bound ? '主角的预约已完成，手续已经办妥。' : '主角的资料整理已完成。';
    const draft = await completeDraft(repo, {
      narrative: evidence,
      variables: {
        ...emptyVariables(),
        commands: [
          {
            type: 'SaveTask',
            commandId: 'done',
            evidence,
            task: { ...state.tasks.appointment, status: 'completed' },
          },
        ],
      },
    });
    if (bound)
      expect((await repo.commitTurn(submission(draft))).state.tasks.appointment.status).toBe(
        'completed',
      );
    else await unchanged(submission(draft));
  });
  it('V1 IndexedDB 升级仅加回执表，旧正式/草稿完全保留', async () => {
    repo.close();
    const legacyFactory = new IDBFactory();
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = legacyFactory.open('legacy', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('saves', { keyPath: 'saveId' });
        open.result.createObjectStore('drafts', { keyPath: 'saveId' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const state = worldState(),
      draft = createTurnDraft('save-a', 0, 'old', 'opening', '旧输入');
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction(['saves', 'drafts'], 'readwrite');
      tx.objectStore('saves').put(state);
      tx.objectStore('drafts').put(draft);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    legacy.close();
    repo = await SaveRepository.open('legacy', legacyFactory);
    expect(await repo.loadGame('save-a')).toEqual({ state, draft });
    expect((await repo.load('save-a')).schemaVersion).toBe(2);
  });
  it('删除存档时回执一并删除，不污染同 ID 的新游戏', async () => {
    const draft = await completeDraft(repo);
    await repo.commitTurn(submission(draft));
    await repo.delete('save-a', 1);
    await repo.create(worldState());
    const next = await completeDraft(repo);
    expect((await repo.commitTurn(submission(next))).replayed).toBe(false);
  });
});
