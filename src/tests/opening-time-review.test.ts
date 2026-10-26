import { describe, expect, it } from 'vitest';
import { openingTimeConstraints, openingTimeSelection } from '../domain/openingTime';
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
describe('PR31复审：开局指令和人物履历的日期用途', () => {
  it.each(expressions)('明确开局年份提取：%s', (text) => {
    expect(openingTimeConstraints('', text)).toEqual([expect.objectContaining({ year: 2015 })]);
  });
  it.each(expressions)('真实开局选择拒绝错误年份：%s', (text) => {
    const { state, draft } = selected('', text);
    expect(() => openingTimeSelection(state, draft)).toThrow('违反玩家');
  });
  it.each([
    ['人物背景：2001年出生，2023年毕业。', '故事发生在2015年夏天。'],
    ['2001年出生，2023年毕业。', '希望设定在2015年。'],
  ])('履历不污染开局：%s + %s', (background, preference) => {
    expect(openingTimeConstraints(background, preference)).toEqual([expect.objectContaining({ year: 2015 })]);
    const { state, draft } = selected(background, preference, 2015);
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2015-07-08T14:00:00+08:00');
  });
  it('背景中的真正故事时间仍生效', () => {
    expect(openingTimeConstraints('角色成长于重庆，故事发生在2008年夏天。', '')).toEqual([expect.objectContaining({ year: 2008, season: '夏' })]);
  });
  it('同段履历与开局分开，不能把前一个年份继承到故事', () => {
    expect(openingTimeConstraints('人物背景：2001年出生，2023年毕业后故事发生在2015年夏天。', '')).toEqual([expect.objectContaining({ year: 2015, season: '夏' })]);
  });
  it('真正冲突的两个开局年份继续拒绝', () => {
    expect(() => openingTimeConstraints('', '故事发生在2008年。开局时间定在2015年。')).toThrow('矛盾');
  });
});

describe('有限日期用途规则的正反边界', () => {
  it('保留原先“设在”的明确背景和偏好句式', () => {
    expect(openingTimeConstraints('故事设在2015年夏天。', '')).toEqual([expect.objectContaining({ year: 2015, season: '夏' })]);
    expect(openingTimeConstraints('', '希望设在2015年。')).toEqual([expect.objectContaining({ year: 2015 })]);
  });
  it('背景的“设在”相对日期同样需要澄清', () => {
    expect(() => openingTimeConstraints('设在今年。', '')).toThrow('明确年份');
  });
  it('未明确标为履历的相对年份不能因出现“工作”就静默忽略', () => {
    expect(() => openingTimeConstraints('', '今年工作。')).toThrow('明确年份');
  });
  it('普通强调不是否定，不因“特别”误拒绝明确设定', () => {
    expect(openingTimeConstraints('', '特别希望设定在2015年。')).toEqual([expect.objectContaining({ year: 2015 })]);
  });
  it.each([
    '人物背景：2001年出生，2023年毕业。',
    '个人履历：出生于2001年，毕业于2023年。',
    '人物背景：2001年7月8日出生，2023年6月1日毕业。',
    '工作经历：2020年入职，2023年搬迁。',
    '人物背景：2020年开始工作，2023年搬到上海。',
    '毕业时间为2023年，入职时间为2024年。',
    '入职日期定为2020年，搬迁时间定在2023年。',
    '人物背景：毕业时间为今年，搬迁时间为明年。',
  ])('明确履历在两个输入位置都不变成开局约束：%s', (text) => {
    expect(openingTimeConstraints(text, '')).toEqual([]);
    expect(openingTimeConstraints('', text)).toEqual([]);
  });
  it.each([
    '人物背景：2001年出生后故事发生在2015年夏天。',
    '故事发生在2015年夏天，主角2001年出生、2023年毕业。',
    '故事发生在2015年夏天主角2001年出生。',
    '毕业时间为2023年。希望设定在2015年夏天。',
  ])('无须忽略整个背景，日期按用途分别提取：%s', (background) => {
    expect(openingTimeConstraints(background, '')).toEqual([expect.objectContaining({ year: 2015, season: '夏' })]);
  });
  it('明确要求从人物出生开始的故事可采用出生年，履历词不是绝对黑名单', () => {
    expect(openingTimeConstraints('', '故事从2001年出生时开始。')).toEqual([expect.objectContaining({ year: 2001 })]);
  });
  it.each(['主角在2015年经历过一件事。', '回想2015年。', '不要设定在2015年。', '如果设定在2015年。'])('无法安全确定的日期明确提示澄清：%s', (text) => {
    expect(() => openingTimeConstraints('', text)).toThrow(/无法确认|无法作为确定设定/);
  });
  it('日期用途分类不取代日历验证，时段/ISO/季节保持原约束', () => {
    expect(openingTimeConstraints('', '希望设定在2024年2月29日晚上8点半。')).toEqual([
      expect.objectContaining({ year: 2024, month: 2, day: 29, hour: 20, minute: 30, period: '晚上' }),
    ]);
    expect(openingTimeConstraints('', '日期定为2022-12-31T16:30:45Z。')).toEqual([
      expect.objectContaining({ year: 2023, month: 1, day: 1, hour: 0, minute: 30, second: 45 }),
    ]);
    expect(() => openingTimeConstraints('', '日期定为2023年2月29日。')).toThrow('无效');
    expect(() => openingTimeConstraints('', '希望设定在今年。')).toThrow('明确年份');
    expect(() => openingTimeConstraints('', '希望设定在2015年。以2008年为起点。')).toThrow('矛盾');
  });
  it('逗号后的季节/时段可补足已明确的背景开局，不把后面的履历继承进来', () => {
    const background = '故事发生在2015年，夏天，下午，2001年出生。';
    const { state, draft } = selected(background, '', 2015);
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2015-07-08T14:00:00+08:00');
    draft.story!.variableGuide[0].observedFact = JSON.stringify({ startAt: '2015-01-08T14:00:00+08:00', endAt: '2015-01-08T14:01:00+08:00' });
    expect(() => openingTimeSelection(state, draft)).toThrow('违反玩家');
  });
});
