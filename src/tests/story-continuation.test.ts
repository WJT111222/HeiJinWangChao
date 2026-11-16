import { describe, expect, it } from 'vitest';
import {
  STORY_CONTINUATION_LIMIT, canContinueStory, continuableStoryFailure, continuationInstruction, mergeContinuation,
  nextStoryPartial, overlapLength, partialWorthKeeping, trimIncompleteTag,
} from '../domain/storyContinuation';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { story } from './fixtures/game';

const partial = '<thinking>提纲</thinking><正文>【旁白】雨丝斜着落进货场，老周蹲在';
function failedDraft(patch: Partial<TurnDraft> = {}) {
  const base = createTurnDraft('save-a', 3, 'turn-4', 'regular', '去码头');
  return TurnDraftSchema.parse({ ...base, draftRevision: 2, stageStatus: { ...base.stageStatus, story: 'failed' },
    storyPartial: { text: partial, storyRevision: 0, continuations: 0 }, ...patch });
}

describe('正文续写：哪些失败可以续写', () => {
  it('没写完的失败可以续写；权限、限流、逻辑校验等不行', () => {
    for (const code of ['output_limit', 'stream_interrupted', 'network', 'timeout']) expect(continuableStoryFailure(code)).toBe(true);
    expect(continuableStoryFailure('invalid_output', 'tag_unclosed')).toBe(true);
    expect(continuableStoryFailure('invalid_output', 'tag_missing')).toBe(true);
    for (const code of ['authorization', 'rate_limit', 'rejected', 'empty', 'time_data']) expect(continuableStoryFailure(code)).toBe(false);
    expect(continuableStoryFailure('invalid_output', 'narrative_short')).toBe(false);
    expect(continuableStoryFailure('invalid_output')).toBe(false);
  });
  it('只保留已经写到规划或正文的内容', () => {
    expect(partialWorthKeeping(partial)).toBe(true);
    expect(partialWorthKeeping('<正文>【旁白】雨丝落下')).toBe(true);
    expect(partialWorthKeeping('   ')).toBe(false);
    expect(partialWorthKeeping('抱歉，我无法继续这个请求。')).toBe(false);
    expect(partialWorthKeeping('<thinking>')).toBe(false);
  });
});

describe('正文续写：拼接', () => {
  it('去掉续写开头与已写结尾重复的文字', () => {
    expect(mergeContinuation(partial, '老周蹲在缆桩边上，烟头一明一灭。</正文>'))
      .toBe('<thinking>提纲</thinking><正文>【旁白】雨丝斜着落进货场，老周蹲在缆桩边上，烟头一明一灭。</正文>');
    expect(overlapLength('abcdef老周蹲在', '老周蹲在缆桩')).toBe(4);
    expect(overlapLength('货场，蹲在', '蹲在缆桩')).toBe(0);
    expect(overlapLength('货场，老周蹲在缆桩', '老周蹲在缆桩边上')).toBe(6);
  });
  it('短重叠不当作重复，正常衔接不被误删', () => {
    expect(mergeContinuation('<正文>【旁白】他说：', '“走。”</正文>')).toBe('<正文>【旁白】他说：“走。”</正文>');
  });
  it('去掉重复输出的规划块和重复打开的 <正文>', () => {
    expect(mergeContinuation(partial, '<thinking>又一份提纲</thinking>\n<正文>缆桩边上。</正文>'))
      .toBe('<thinking>提纲</thinking><正文>【旁白】雨丝斜着落进货场，老周蹲在缆桩边上。</正文>');
  });
  it('截断在半个标签上：去掉残片，由续写补出完整标签', () => {
    const cut = '<正文>【旁白】完。</正文><短期记';
    expect(trimIncompleteTag(cut)).toBe('<正文>【旁白】完。</正文>');
    expect(mergeContinuation(cut, '<短期记忆>码头</短期记忆>')).toBe('<正文>【旁白】完。</正文><短期记忆>码头</短期记忆>');
    expect(trimIncompleteTag('<正文>【旁白】a<b')).toBe('<正文>【旁白】a');
  });
  it('续写指令按行动选项开关列出要补齐的标签', () => {
    expect(continuationInstruction(true)).toContain('<行动选项>');
    expect(continuationInstruction(false)).not.toContain('<行动选项>');
    expect(continuationInstruction(true)).toContain('不要重复已经写过的任何文字');
  });
});

describe('正文续写：草稿字段与资格', () => {
  it('旧草稿没有该字段照常可用；有完整正文时不能带截断正文', () => {
    const base = createTurnDraft('save-a', 3, 'turn-4', 'regular', '去码头');
    expect(TurnDraftSchema.parse(base).storyPartial).toBeUndefined();
    expect(TurnDraftSchema.safeParse({ ...base, story: { ...story, turnKind: 'regular' }, storyRevision: 1, stageStatus: { ...base.stageStatus, story: 'ready' },
      storyPartial: { text: partial, storyRevision: 1, continuations: 0 } }).success).toBe(false);
    expect(TurnDraftSchema.safeParse({ ...base, storyPartial: { text: partial, storyRevision: 5, continuations: 0 } }).success).toBe(false);
    expect(TurnDraftSchema.safeParse({ ...base, storyPartial: { text: partial, storyRevision: 0, continuations: STORY_CONTINUATION_LIMIT + 1 } }).success).toBe(false);
  });
  it('正文生成成功后清掉截断正文', () => {
    expect(rerollStory(failedDraft(), { ...story, turnKind: 'regular' }).storyPartial).toBeUndefined();
  });
  it('失败、未超次数、版本一致时才可续写', () => {
    expect(canContinueStory(failedDraft())).toBe(true);
    expect(canContinueStory(failedDraft({ storyPartial: { text: partial, storyRevision: 0, continuations: STORY_CONTINUATION_LIMIT } }))).toBe(false);
    expect(canContinueStory(failedDraft({ stageStatus: { story: 'pending', variables: 'pending', world: 'pending' } }))).toBe(false);
    expect(canContinueStory(failedDraft({ storyPartial: undefined }))).toBe(false);
    expect(canContinueStory(undefined)).toBe(false);
  });
});

describe('正文续写：失败后保存什么', () => {
  const fresh = failedDraft({ storyPartial: undefined });
  it('普通生成被截断：保存收到的原文，续写次数为 0', () => {
    expect(nextStoryPartial(fresh, { code: 'output_limit' }, partial, false)).toEqual({ text: partial, storyRevision: 0, continuations: 0 });
  });
  it('普通生成因其他原因失败：不保存', () => {
    expect(nextStoryPartial(fresh, { code: 'authorization' }, partial, false)).toBeUndefined();
    expect(nextStoryPartial(fresh, { code: 'output_limit' }, '   ', false)).toBeUndefined();
  });
  it('续写又被截断：保存拼接后的原文并累计次数', () => {
    const longer = `${partial}缆桩边上`;
    expect(nextStoryPartial(failedDraft(), { code: 'stream_interrupted' }, longer, true)).toEqual({ text: longer, storyRevision: 0, continuations: 1 });
  });
  it('续写因其他原因失败：保留原来的截断原文，消耗一次次数', () => {
    expect(nextStoryPartial(failedDraft(), { code: 'rate_limit' }, undefined, true)).toEqual({ text: partial, storyRevision: 0, continuations: 1 });
  });
  it('从头重新生成时不沿用旧的截断原文', () => {
    expect(nextStoryPartial(failedDraft(), { code: 'rate_limit' }, undefined, false)).toBeUndefined();
  });
});
