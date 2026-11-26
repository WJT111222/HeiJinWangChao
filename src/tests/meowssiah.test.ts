import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canResumeWriting, captureStoryWriting, resolveStoryPreset } from '../presets/library';
import { defaultSettings } from '../ui/settings/model';
import { defaults, menu } from '../presets/meowssiah/config';
import { oracleDefinition as definition } from '../presets/meowssiah/definition';
import { readLiteraryResponse } from '../presets/spreset/readLiteraryResponse';
import { assemblePreset } from '../presets/messages';
import { orderResponse, orderSamples } from './fixtures/toolOrder';
import { SaveRepository } from '../services/storage/saveRepository';
import { talentPromptInput } from './fixtures/talentPrompt';
import { createTurnDraft, rerollStory } from '../domain/drafts';

const prompts = defaultSettings().prompts;
const signal = new AbortController().signal;
describe('神域文学配置、权利清单与处理器', () => {
  it('固定组件及文学版本逐字节吻合', async () => {
    const path = new URL('../../experiments/meowssiah/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('SOURCES.json', path), 'utf8'));
    for (const [file, sha] of Object.entries(manifest.localFiles))
      expect(
        createHash('sha256')
          .update(await readFile(new URL(file, path)))
          .digest('hex'),
      ).toBe(sha);
    expect(definition.version).toContain(
      createHash('sha256').update(Object.values(manifest.localFiles).join('')).digest('hex'),
    );
  });
  it('等效配置、关闭条目的改写、有效采样、提示词和互斥', async () => {
    const pack = await resolveStoryPreset({ definition }),
      base = await captureStoryWriting({ definition }, prompts);
    const edits = defaults();
    const off = menu.find((row) => !pack.entries.find((e) => e.identifier === row.id)!.enabled)!;
    edits.entries[off.id] = { enabled: false, content: '未启用的合成文本' };
    edits.sampling = { top_p: pack.sampling.top_p };
    const writing = () => captureStoryWriting({ definition, overrides: edits }, prompts);
    expect(await writing()).toEqual(base);
    edits.sampling.top_p = 0.51;
    expect(await canResumeWriting(base, await writing(), { definition, overrides: edits })).toBe(false);
    edits.sampling = {};
    edits.entries['catgod-direction'] = { content: '用短句写雨声' };
    expect(await writing()).not.toEqual(base);
    for (const row of menu.filter((r) => r.group === '主文风选择')) edits.entries[row.id] = { enabled: true };
    await expect(writing()).rejects.toThrow('同组');
  });
  it('历史过滤发生在发送副本，正式历史、知识和当前行动保持独立', async () => {
    const pack = await resolveStoryPreset({ definition });
    const materials = {
      user: '林舟',
      char: '沈宁',
      markers: {},
      history: [
        { role: 'assistant' as const, content: '先前正文<think_nya>旧附注</think_nya>' },
        { role: 'user' as const, content: '翻开账册' },
      ],
    };
    const first = assemblePreset(pack, materials),
      second = assemblePreset(pack, materials);
    expect(second).toEqual(first);
    expect(first.history).toEqual([
      { role: 'assistant', content: '先前正文' },
      { role: 'user', content: '翻开账册' },
    ]);
    expect(materials.history[0].content).toContain('旧附注');
    expect(first.unknownMacros).toEqual([]);
  });
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
            'soliumbra_reply',
            'game_content',
            {},
            ['think_nya'],
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
        { instance: first.instance, noteId: first.note!.id },
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
      const candidate = rerollStory(stored, story, await captureStoryWriting({ definition }, prompts));
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
