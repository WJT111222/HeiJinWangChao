import { z } from 'zod';
import { GameTimeSchema, requireData } from './common';
import type { GameState } from './state';
import type { TurnDraft } from './drafts';

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
export function openingTimeSelection(state: GameState, draft: Pick<TurnDraft, 'turnKind' | 'story' | 'userInput'>) {
  if (!state.openingTimePending) return undefined;
  requireData(draft.turnKind === 'opening' && state.turnNumber === 0, 'OPENING_TIME', '待定时钟只能用于新开局');
  requireData(!draft.story?.variableGuide.some((entry) => entry.group === 'time' && entry.subjectHint?.startsWith('time:') && entry.subjectHint !== 'time:opening'),
    'OPENING_TIME', '待定开局不能混用普通回合的时间停止或历史回顾协议');
  const entries = draft.story?.variableGuide.filter((entry) => entry.group === 'time' && entry.subjectHint === 'time:opening') ?? [];
  requireData(entries.length === 1, 'OPENING_TIME', '开局缺少唯一的结构化时间，请重新生成开局正文。');
  let raw: unknown;
  try { raw = JSON.parse(entries[0].observedFact); } catch { requireData(false, 'OPENING_TIME', '开局时间不是合法JSON'); }
  const parsed = OpeningTimeSchema.safeParse(raw);
  requireData(parsed.success, 'OPENING_TIME', '开局时间格式或日历日期无效');
  const selected = parsed.data, { startAt, endAt } = selected;
  requireData(startAt.endsWith('+08:00') && endAt.endsWith('+08:00') && Date.parse(endAt) >= Date.parse(startAt),
    'OPENING_TIME', '开局须采用中国标准时间，结束时间不可早于起点。');
  const calendar = chinaCalendar(startAt);
  requireData(calendar.year >= 1, 'OPENING_TIME', '开局年份必须是合法公历年份');
  // 年代/季节/文风由同次Story遵守玩家设定；程序不再从小说文字反推日历。
  const evidence = entries[0].textEvidence?.trim() || 'Story结构化开局时间';
  return { ...selected, evidence, weekday: calendar.weekday };
}
// 只构造内存计算基线；正式记录的标记只在整回合事务成功时才消失。
export function openingTimeBase(state: GameState, draft: Pick<TurnDraft, 'turnKind' | 'story' | 'userInput'>): GameState {
  const selected = openingTimeSelection(state, draft);
  if (!selected) return state;
  const base = { ...state, worldClock: selected.startAt };
  delete base.openingTimePending;
  return base;
}
export function openingTimeContext(state: GameState, input: string) {
  if (!state.openingTimePending) return undefined;
  return { status: 'pending', playerBackground: state.protagonist.background ?? '', playerPreference: input,
    policy: '优先遵守玩家明确的年代/日期/季节；无设定时由本次Story合理安排，不使用设备或模型当前日期。人物履历不等于开局年代，矛盾或含糊设定如实说明，不按现实年份猜测。',
    guideContract: '同一次正文输出在变量规划给出唯一group=time、subjectHint=time:opening、observedFact=JSON.stringify({startAt,endAt})，均为合法ISO +08:00且endAt不早于startAt。startAt是开场起点，endAt是本幕实际结束。无需在正文插入日期、时间词或逐字互证。此结构化时间是唯一开局时钟候选，程序统一用于变量投影、世界窗口和首次原子结算；变量阶段无需再次输出SetWorldClock，不重复加耗时。未提交前不是正式事实。' };
}
