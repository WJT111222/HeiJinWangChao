import { describe, expect, it } from 'vitest';
import { openingTimeContext, openingTimeSelection } from '../domain/openingTime';
import { newCreation, buildCreationState } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { StorySchema } from '../domain/state';

const expressions = ['希望设定在2015年。', '日期定为2015年。', '以2015年为起点。', '设定于2015年。', '希望从2015年起。', '让主角在2015年登场。'];
function selected(background: string, preference: string, year = 2016) {
  const form = { ...newCreation(), background, openingPreference: preference,
    person: { name: '林舟', age: '30', gender: '女', appearance: '', personality: '' }, profession: '教师' };
  const state = buildCreationState(form, defaultSettings());
  const anchor = `${year}年7月8日14:00，重庆街头。`;
  const story = StorySchema.parse({ turnKind: 'opening', narrative: `${anchor}主角在街边喝水。`, summary: '主角喝水。',
    variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: `${year}-07-08T14:00:00+08:00`, endAt: `${year}-07-08T14:01:00+08:00` }), textEvidence: anchor }] });
  return { state, draft: rerollStory(createTurnDraft(state.saveId, 0, 'opening-review', 'opening', preference), story) };
}
// M8-P0A supersedes PR31's deterministic natural-language date interpretation.
// All prior input cases are retained; now verify lossless prompt delivery, not literary rejection.
function context(background: string, preference: string) {
  const { state } = selected(background, preference);
  return openingTimeContext(state, preference)!;
}
describe('M8-P0A：开局时间意图交给同一次Story，不用程序解释中文', () => {
  it.each(expressions)('明确偏好原文传入：%s', (text) => {
    expect(context('', text).playerPreference).toBe(text);
  });
  it.each(expressions)('合法结构化候选不因年份文字交叉审查失败：%s', (text) => {
    const { state, draft } = selected('', text);
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2016-07-08T14:00:00+08:00');
    expect(context('', text).policy).toContain('优先遵守');
  });
  it.each([
    ['人物背景：2001年出生，2023年毕业。', '故事发生在2015年夏天。'],
    ['2001年出生，2023年毕业。', '希望设定在2015年。'],
  ])('履历与偏好独立完整保留：%s + %s', (background, preference) => {
    expect(context(background, preference)).toMatchObject({ playerBackground: background, playerPreference: preference });
  });
  it('背景中的故事时间不被删除', () => {
    const text = '角色成长于重庆，故事发生在2008年夏天。';
    expect(context(text, '').playerBackground).toBe(text);
  });
  it('同段履历和开局不被错误拆分', () => {
    const text = '人物背景：2001年出生，2023年毕业后故事发生在2015年夏天。';
    expect(context(text, '').playerBackground).toBe(text);
  });
  it('矛盾年份交给Story处理，不在创角请求前正则拒绝', () => {
    const text = '故事发生在2008年。开局时间定在2015年。';
    expect(context('', text).playerPreference).toBe(text);
    expect(context('', text).policy).toContain('矛盾');
  });
});
describe('原有日期用途输入回归：保留用户意图，不用设备日期推测', () => {
  it('保留设在句式', () => {
    expect(context('故事设在2015年夏天。', '希望设在2015年。')).toMatchObject({ playerBackground: '故事设在2015年夏天。', playerPreference: '希望设在2015年。' });
  });
  it('背景相对年份不替换成现实年份', () => expect(context('设在今年。', '').playerBackground).toBe('设在今年。'));
  it('相对年份不会因工作词被静默删除', () => expect(context('', '今年工作。').playerPreference).toBe('今年工作。'));
  it('强调不是程序否定门槛', () => expect(context('', '特别希望设定在2015年。').playerPreference).toBe('特别希望设定在2015年。'));
  it.each([
    '人物背景：2001年出生，2023年毕业。', '个人履历：出生于2001年，毕业于2023年。',
    '人物背景：2001年7月8日出生，2023年6月1日毕业。', '工作经历：2020年入职，2023年搬迁。',
    '人物背景：2020年开始工作，2023年搬到上海。', '毕业时间为2023年，入职时间为2024年。',
    '入职日期定为2020年，搬迁时间定在2023年。', '人物背景：毕业时间为今年，搬迁时间为明年。',
  ])('两个输入位置的履历都无损传递：%s', (text) => {
    expect(context(text, '').playerBackground).toBe(text);
    expect(context('', text).playerPreference).toBe(text);
  });
  it.each([
    '人物背景：2001年出生后故事发生在2015年夏天。', '故事发生在2015年夏天，主角2001年出生、2023年毕业。',
    '故事发生在2015年夏天主角2001年出生。', '毕业时间为2023年。希望设定在2015年夏天。',
  ])('混合背景保留完整语义：%s', (text) => expect(context(text, '').playerBackground).toBe(text));
  it('从出生开始的故事不被履历关键词排除', () => expect(context('', '故事从2001年出生时开始。').playerPreference).toBe('故事从2001年出生时开始。'));
  it.each(['主角在2015年经历过一件事。', '回想2015年。', '不要设定在2015年。', '如果设定在2015年。'])('含糊/否定/条件意图不被擅自改写：%s', (text) => expect(context('', text).playerPreference).toBe(text));
  it('日期时段ISO及非法自然语言不成为第二套日历真值', () => {
    for (const text of ['希望设定在2024年2月29日晚上8点半。', '日期定为2022-12-31T16:30:45Z。', '日期定为2023年2月29日。', '希望设定在今年。', '希望设定在2015年。以2008年为起点。'])
      expect(context('', text).playerPreference).toBe(text);
  });
  it('逗号后的季节/履历原样保留，程序仅认合法结构化时钟', () => {
    const background = '故事发生在2015年，夏天，下午，2001年出生。';
    const { state, draft } = selected(background, '', 2015);
    expect(context(background, '').playerBackground).toBe(background);
    draft.story!.variableGuide[0].observedFact = JSON.stringify({ startAt: '2015-01-08T14:00:00+08:00', endAt: '2015-01-08T14:01:00+08:00' });
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2015-01-08T14:00:00+08:00');
  });
});
