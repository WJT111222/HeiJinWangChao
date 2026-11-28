import { describe, expect, it } from 'vitest';
import { readLiteraryResponse } from '../presets/spreset/readLiteraryResponse';
import { orderResponse, orderSamples } from './fixtures/toolOrder';
import { SaveRepository } from '../services/storage/saveRepository';
import { talentPromptInput } from './fixtures/talentPrompt';
import { createTurnDraft, rerollStory } from '../domain/drafts';

describe('文学预设公共终端响应校验', () => {
  const signal = new AbortController().signal;
  for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const)
    for (const stream of [false, true])
      it(protocol + (stream ? ' SSE' : ' JSON') + ' 纯文本、竞争正文和终端身份', async () => {
        for (const name of ['thought–plain', 'prose–tool', 'tool']) {
          const sample = orderSamples(protocol, stream).find((row) => row.name === name)!;
          const f = orderResponse(protocol, stream, sample);
          const outcome = readLiteraryResponse(
            new Response(f.body),
            protocol,
            signal,
            'test_delivery',
            'payload',
            {},
            ['annotation'],
          );
          if (name === 'thought–plain') {
            const result = await outcome;
            expect(result.call).toBeUndefined();
            expect(result.reasoning).toBeTruthy();
          } else await expect(outcome).rejects.toThrow();
        }
      });
});

describe('小纸条与候选共用存储事务', () => {
  it('旧编辑冲突、刷新、取消与替换中的纸条', async () => {
    const db = 'oracle-note-' + crypto.randomUUID();
    let repo = await SaveRepository.open(db);
    try {
      const input = talentPromptInput('story', 'regular'),
        { state } = input;
      const draft = createTurnDraft(
        state.saveId,
        state.revision,
        'oracle-note',
        'regular',
        '核对账册',
        false,
        false,
        false,
      );
      const backup = { state, draft };
      await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
      const empty = await repo.readOracleNote(state.saveId);
      const first = await repo.writeOracleNote(state.saveId, empty, '第一次', true);
      await expect(repo.writeOracleNote(state.saveId, empty, '冲突', true)).rejects.toThrow();
      const next = await repo.writeOracleNote(
        state.saveId,
        first,
        '另一次',
        true,
      );
      const stored = (await repo.loadDraft(state.saveId))!,
        lease = await repo.prepareWorldview(stored, false);
      const story = {
        turnKind: 'regular' as const,
        narrative: '一幕',
        summary: '已核对',
        variableGuide: [],
        actionOptions: [],
      };
      const candidate = rerollStory(stored, story, { source: 'preset', id: 'meowssiah', version: 'previous', configuration: '0'.repeat(64) });
      await expect(
        repo.saveDraft(candidate, stored.draftRevision, AbortSignal.abort(), stored, lease, next.note!.id),
      ).rejects.toThrow();
      repo.close();
      repo = await SaveRepository.open(db);
      expect((await repo.readOracleNote(state.saveId)).note).toEqual(next.note);
      await repo.saveDraft(candidate, stored.draftRevision, undefined, stored, lease, first.note!.id);
      expect((await repo.readOracleNote(state.saveId)).note).toEqual(next.note);
      expect((await repo.load(state.saveId)).revision).toBe(state.revision);
    } finally {
      repo.close();
    }
  });
});
