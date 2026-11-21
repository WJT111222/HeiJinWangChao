import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../domain/state';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseWorld } from '../services/validation/aiOutputs';
import { parsePartialVariables } from '../services/validation/partialOutputs';
import { defaultSettings } from '../ui/settings/model';
import { game, npc } from './fixtures/game';
import { joinFamily } from './fixtures/harem';
import { worldDraft, worldResult } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';

const setup = () => {
  const state = game();
  state.npc.a = { ...npc('a'), gender: 'female', age: 25 };
  return { state, draft: worldDraft(false, 'opening') };
};
const wrap = (lines: string[]) =>
  '<thinking>记录当轮事实。</thinking><说明>更新家庭。</说明><命令>\n' + lines.join('\n') + '\n</命令>';
const baby = { ...npc('baby'), age: 0, gender: 'unknown' };
const { id, ...babyFields } = baby;
const createChild = 'set npc[' + id + '] = ' + JSON.stringify(babyFields);
const birth = {
  op: 'child',
  reason: '已确认出生及亲子关系',
  value: {
    childNpcId: id,
    parentNpcId: 'a',
    kinship: 'biological',
    protagonistParentage: 'confirmed',
    visibility: 'player_known',
  },
};
const text = (changes: unknown[]) => 'set harem.changes = ' + JSON.stringify(changes);

describe('后宫经过正式 Variables、World 权限与存储链', () => {
  it.each(['wrong-parent', 'bad-child', 'malformed', 'malformed-list'])(
    '出生登记 %s 失败不单存新生儿，独立情绪可结算',
    async (failure) => {
      const { state, draft } = setup();
      const line =
        failure === 'malformed'
          ? 'set harem.changes = "错误"'
          : failure === 'malformed-list'
            ? 'set harem.changes = [{}]'
            : text([
                joinFamily('a', 100),
                failure === 'wrong-parent'
                  ? { ...birth, value: { ...birth.value, parentNpcId: 'missing' } }
                  : birth,
              ]);
      const result = await parsePartialVariables(
        wrap([
          failure === 'bad-child' ? createChild.replace('"age":0', '"age":-1') : createChild,
          line,
          'set protagonist.emotionText = "释然"',
        ]),
        state,
        draft,
      );
      expect(result.commands.map((c) => c.type)).toEqual(['UpdateProtagonist']);
      expect(result.settlement?.skipped.map((s) => s.commandIndex)).toEqual([0, 1]);
      expect(state.harem).toBeUndefined();
      expect(state.npc.baby).toBeUndefined();
    },
  );
  it('同批出生与家庭结构经过 Commit、跨连接、导出导入、重放和 Undo；旧候选不能复活', async () => {
    const original = setup().state,
      factory = new IDBFactory(),
      repo = await SaveRepository.open('household', factory);
    const other = await SaveRepository.open('household', factory);
    try {
      await repo.create(original);
      const opening = await completeDraft(repo, {
        variables: { commands: [], rejectedSuggestions: [], unresolved: [] },
      });
      const first = await repo.commitTurn(submission(opening));
      const state = first.state,
        draft = rerollStory(first.draft, {
          turnKind: 'regular',
          narrative: '家庭登记',
          summary: '登记',
          variableGuide: [],
        });
      const result = await parsePartialVariables(
        wrap([createChild, text([joinFamily('a', 100), birth])]),
        state,
        draft,
      );
      expect(result.settlement?.skipped ?? []).toEqual([]);
      expect(result.commands.map((c) => c.type)).toEqual(['CreateNpc', 'ApplyHaremChanges']);
      const ready = await completeDraft(repo, { variables: result });
      expect((await other.load('save-a')).harem).toBeUndefined();
      const newStory = rerollStory(ready, ready.story!);
      expect(newStory.variables).toBeUndefined();
      expect(projectTurn(state, newStory).harem).toBeUndefined();
      const noVars = createTurnDraft('save-a', state.revision, 'other-turn', 'regular', '', false, false);
      expect(projectTurn(state, noVars).harem).toBeUndefined();
      const committed = await repo.commitTurn(submission(ready));
      expect((await other.commitTurn(submission(ready))).replayed).toBe(true);
      const stored = await other.load('save-a');
      expect(stored.harem?.children).toHaveLength(1);
      expect(stored.npc.baby.age).toBe(0);
      const [backup] = await repo.exportBackup(['save-a']);
      expect(GameStateSchema.parse(backup.state)).toEqual(stored);
      const copy = await SaveRepository.open('copy', factory);
      try {
        await copy.importBackup(backup, (await copy.compareBackup(backup)).confirmation);
        expect((await copy.load('save-a')).harem).toEqual(stored.harem);
      } finally {
        copy.close();
      }
      for (const stage of ['story', 'variables', 'world'] as const) {
        const prompt = await composePrompt({
          stage,
          mode: 'regular',
          settings: defaultSettings(),
          state: stored,
          draft: rerollStory(committed.draft, {
            turnKind: 'regular',
            narrative: '继续生活',
            summary: '生活',
            variableGuide: [],
          }),
          userInput: '',
        });
        if (stage === 'world') expect(JSON.stringify(prompt.context)).not.toContain('protagonistParentage');
        else expect(prompt.context.SAVE_STATE).toHaveProperty('harem.children.0.childNpcId', 'baby');
      }
      const undone = await other.undoTurn({
        saveId: 'save-a',
        expectedRevision: stored.revision,
        expectedDraft: committed.draft,
        operationId: 'undo-family',
      });
      expect(undone.state.harem).toBeUndefined();
      expect(undone.state.npc.baby).toBeUndefined();
      await expect(repo.commitTurn(submission(ready))).rejects.toThrow();
    } finally {
      other.close();
      repo.close();
    }
  });
  it.each(['worldCommands', 'taskCommands', 'eventCommands'])(
    'World %s 拒绝家庭命令，投影不泄漏家庭候选',
    async (group) => {
      const { state, draft } = setup();
      const result = await parsePartialVariables(wrap([text([joinFamily('a', 100)])]), state, draft);
      expect(result.commands[0].type).toBe('ApplyHaremChanges');
      expect(() =>
        parseWorld(JSON.stringify({ ...worldResult(), [group]: result.commands }), state, draft),
      ).toThrow();
      const selected = {
        ...draft,
        stageStatus: { ...draft.stageStatus, variables: 'ready' as const },
        variables: {
          storyRevision: draft.storyRevision,
          candidateRevision: 1,
          requestRevision: 0,
          validation: 'validated' as const,
          result,
        },
      };
      const prompt = await composePrompt({
        stage: 'world',
        mode: 'opening',
        state,
        draft: selected,
        userInput: '',
        settings: defaultSettings(),
      });
      expect(JSON.stringify(prompt.messages)).not.toMatch(
        /ApplyHaremChanges|harem\.changes|双方决定以家庭成员身份/,
      );
    },
  );
});
