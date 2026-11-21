import { z } from 'zod';
import { GameTimeSchema } from './common';
import { requireStoryData, storyFieldPath } from './storyDiagnostics';
import type { GameState } from './state';
import type { TurnDraft } from './drafts';
import type { DomainCommand } from './commands';

type OpeningDraft = Pick<TurnDraft, 'turnKind' | 'story' | 'userInput'> & Partial<Pick<TurnDraft, 'variables' | 'useVariableStage'>>;
export function variablesChooseOpening(draft: OpeningDraft) {
  return draft.story?.variableGuideRaw !== undefined && (draft.useVariableStage === true || draft.variables?.validation === 'validated');
}
// 仅满足旧 ISO 字段的存储形状，不是剧情基线；任何计算前必须解析真实开局。
export const pendingOpeningClock = '0001-01-01T00:00:00+08:00';
const chinaOffset = 8 * 3600000;
export function chinaCalendar(time: string) {
  GameTimeSchema.parse(time);
  const local = new Date(Date.parse(time) + chinaOffset);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
    weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][local.getUTCDay()] };
}
const OpeningTimeSchema = z.strictObject({ startAt: GameTimeSchema, endAt: GameTimeSchema });
export function parseOpeningTimeFact(raw: unknown) {
  const parsed = OpeningTimeSchema.safeParse(raw);
  requireStoryData(parsed.success, 'OPENING_TIME', '开局时间格式或日历日期无效', { storyRule: 'opening_format',
    fieldPath: storyFieldPath(['openingTime', ...(parsed.success ? [] : parsed.error.issues[0]?.path ?? [])]) });
  const { startAt, endAt } = parsed.data;
  requireStoryData(startAt.endsWith('+08:00') && endAt.endsWith('+08:00') && Date.parse(endAt) >= Date.parse(startAt),
    'OPENING_TIME', '开局须采用中国标准时间，结束时间不可早于起点。', {
      storyRule: !startAt.endsWith('+08:00') || !endAt.endsWith('+08:00') ? 'opening_timezone' : 'opening_reversed' });
  requireStoryData(chinaCalendar(startAt).year >= 1, 'OPENING_TIME', '开局年份必须是合法公历年份', { storyRule: 'opening_year' });
  requireStoryData(Date.parse(startAt) !== Date.parse(pendingOpeningClock), 'OPENING_TIME', '不能使用待定时钟占位值', { storyRule: 'opening_format' });
  return parsed.data;
}
export function openingTimeSelection(state: GameState, draft: OpeningDraft, commands?: readonly DomainCommand[]) {
  if (!state.openingTimePending) return undefined;
  requireStoryData(draft.turnKind === 'opening' && state.turnNumber === 0, 'OPENING_TIME', '待定时钟只能用于新开局', { storyRule: 'opening_context' });
  if (variablesChooseOpening(draft)) {
    const candidate = commands ?? (draft.variables?.validation === 'validated' ? draft.variables.result.commands : []);
    const clocks = candidate.filter(command => command.type === 'SetWorldClock');
    if (!clocks.length) return undefined; // Variables has not supplied a window yet.
    requireStoryData(clocks.length <= 2, 'OPENING_TIME', '开局只需给出本幕起点与终点', { storyRule: 'opening_duplicate' });
    const selected = parseOpeningTimeFact({ startAt: clocks[0].worldClock, endAt: clocks.at(-1)!.worldClock });
    return { ...selected, evidence: 'Variables 开局时钟', weekday: chinaCalendar(selected.startAt).weekday };
  }
  requireStoryData(!draft.story?.variableGuide.some((entry) => entry.group === 'time' && entry.subjectHint?.startsWith('time:') && entry.subjectHint !== 'time:opening'),
    'OPENING_TIME', '待定开局不能混用普通回合的时间停止或历史回顾协议', { storyRule: 'opening_protocol' });
  const entries = draft.story?.variableGuide.filter((entry) => entry.group === 'time' && entry.subjectHint === 'time:opening') ?? [];
  requireStoryData(entries.length === 1, 'OPENING_TIME', '开局尚无可提交的时间。可启用变量管理，按已选正文确定时间。', { storyRule: entries.length === 0 ? 'opening_missing' : 'opening_duplicate' });
  let raw: unknown;
  try { raw = JSON.parse(entries[0].observedFact); } catch { requireStoryData(false, 'OPENING_TIME', '开局时间不是合法JSON', { storyRule: 'opening_json' }); }
  const selected = parseOpeningTimeFact(raw);
  // 年代/季节/文风由同次Story遵守玩家设定；程序不再从小说文字反推日历。
  const evidence = entries[0].textEvidence?.trim() || 'Story结构化开局时间';
  return { ...selected, evidence, weekday: chinaCalendar(selected.startAt).weekday };
}
// 只构造内存计算基线；正式记录的标记只在整回合事务成功时才消失。
export function openingTimeBase(state: GameState, draft: OpeningDraft, commands?: readonly DomainCommand[]): GameState {
  const selected = openingTimeSelection(state, draft, commands);
  if (!selected) return state;
  const base = { ...state, worldClock: selected.startAt };
  delete base.openingTimePending;
  return base;
}
export function openingTimeContext(state: GameState, input: string) {
  if (!state.openingTimePending) return undefined;
  return { status: 'pending', playerBackground: state.protagonist.background ?? '', playerPreference: input,
    policy: '优先遵守玩家明确的年代/日期/季节；无设定时由本次Story合理安排，不使用设备或模型当前日期。人物履历不等于开局年代，矛盾或含糊设定如实说明，不按现实年份猜测。',
    guideContract: '可在笔记中说明开场和结束时间。启用变量管理时由 Variables 根据正文、玩家年代设定和当前存档确定正式窗口；纯小说开局仍需一条合法 time:opening（observedFact 为 {startAt,endAt}，中国标准时间 +08:00）才能定钟。' };
}
