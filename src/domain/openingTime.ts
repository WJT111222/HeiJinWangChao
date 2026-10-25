import { z } from 'zod';
import { isNegatedFact } from './factPolarity';
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
interface TimeConstraint { year?: number; month?: number; day?: number; hour?: number; minute?: number; second?: number; season?: string; period?: string }
// 只识别明确的数字日历约束，不宣称理解任意中文。历史履历日期不自动成为开局设定。
export function openingTimeConstraints(background: string, preference: string): TimeConstraint[] {
  const clauses = [
    ...background.split(/[。；\n]/).filter((text) => /(?:故事|背景|开局|时代|时间|设在|发生在)/.test(text)),
    ...preference.split(/[。；\n]/).filter((text) => /(?:故事|背景|开局|时代|时间|设在|发生在|开始)/.test(text) || /^\s*\d{4}\s*(?:年|-)/.test(text)
      || /今年|明年|去年|今天|明天|昨天|后天|很久以前|[春夏秋冬][天季]/.test(text)),
  ];
  requireData(!clauses.some((text) => /今年|明年|去年|今天|明天|昨天|后天|很久以前/.test(text)), 'OPENING_TIME_INPUT',
    '开局时间需要明确年份；“今年”等相对时间不会按设备日期解释，请在开局偏好中写明或删除该约束。');
  const constraints: TimeConstraint[] = [];
  for (const clause of clauses) {
    // ISO显式偏移优先换算为中国标准时间；不把UTC中的年份/时刻误当成本地约束。
    const text = clause.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g, (iso) => {
      requireData(GameTimeSchema.safeParse(iso).success, 'OPENING_TIME_INPUT', '开局ISO时间无效，请提供完整秒和时区偏移。');
      const { year, month, day, hour, minute, second } = chinaCalendar(iso);
      constraints.push({ year, month, day, hour, minute, second });
      return '';
    });
    const matches = [...text.matchAll(/(\d{4})\s*(?:年|-)\s*(?:(\d{1,2})\s*(?:月|-)\s*(?:(\d{1,2})\s*(?:日|号)?)?)?/g)];
    for (const match of matches) {
      const [, y, m, d] = match, year = Number(y), month = m ? Number(m) : undefined, day = d ? Number(d) : undefined;
      const tail = text.slice(match.index + match[0].length);
      const clock = tail.match(/(?:T|\s)*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      const point = !clock ? tail.match(/(\d{1,2})点(?:(半)|(\d{1,2})分?)?/) : undefined;
      let hour = clock ? Number(clock[1]) : point ? Number(point[1]) : undefined;
      const minute = clock ? Number(clock[2]) : point ? point[2] ? 30 : Number(point[3] ?? 0) : undefined;
      const period = tail.match(/凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/)?.[0];
      if (hour !== undefined && /下午|傍晚|晚上/.test(period ?? '') && hour < 12) hour += 12;
      const season = tail.match(/春(?:天|季)|夏(?:天|季)|秋(?:天|季)|冬(?:天|季)/)?.[0]?.[0];
      const date = `${y}-${String(month ?? 1).padStart(2, '0')}-${String(day ?? 1).padStart(2, '0')}T${String(hour ?? 0).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}:00+08:00`;
      requireData(year >= 1 && GameTimeSchema.safeParse(date).success, 'OPENING_TIME_INPUT', '开局日期或时刻无效，请检查闰年、月份和日期。');
      constraints.push({ year, month, day, hour, minute, second: clock?.[3] ? Number(clock[3]) : undefined, season, period });
    }
    if (!matches.length) {
      const season = text.match(/春[天季]|夏[天季]|秋[天季]|冬[天季]/)?.[0]?.[0];
      const period = text.match(/凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/)?.[0];
      if (season || period) constraints.push({ season, period });
    }
  }
  const years = new Set(constraints.map((item) => item.year).filter((value) => value !== undefined));
  requireData(years.size <= 1, 'OPENING_TIME_INPUT', '开局年份约束互相矛盾，请在开局偏好中明确一个年份。');
  for (const key of ['month', 'day', 'hour', 'minute', 'second', 'season', 'period'] as const)
    requireData(new Set(constraints.map((item) => item[key]).filter((value) => value !== undefined)).size <= 1,
      'OPENING_TIME_INPUT', '开局日期或时段约束互相矛盾，请先调整设定。');
  const month = constraints.find((item) => item.month !== undefined)?.month;
  const season = constraints.find((item) => item.season)?.season;
  requireData(!month || !season || months[season].includes(month), 'OPENING_TIME_INPUT', '开局月份与季节互相矛盾，请先调整设定。');
  return constraints;
}
const months: Record<string, number[]> = { 春: [3, 4, 5], 夏: [6, 7, 8], 秋: [9, 10, 11], 冬: [12, 1, 2] };
function periodMatches(period: string | undefined, hour: number) {
  if (!period) return true;
  const ranges: Record<string, number[]> = { 凌晨: [0, 5], 早上: [6, 11], 早晨: [6, 11], 上午: [6, 11], 中午: [11, 13], 下午: [12, 17], 傍晚: [17, 20], 晚上: [18, 23], 夜里: [0, 5, 18, 23] };
  const range = ranges[period];
  return hour >= range[0] && hour <= range[1] || range.length === 4 && hour >= range[2] && hour <= range[3];
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
  requireData(startAt.endsWith('+08:00') && endAt.endsWith('+08:00') && Date.parse(endAt) > Date.parse(startAt),
    'OPENING_TIME', '开局须采用中国标准时间，并有符合实际行动的正向耗时。');
  const calendar = chinaCalendar(startAt);
  requireData(calendar.year >= 1, 'OPENING_TIME', '开局年份必须是合法公历年份');
  for (const constraint of openingTimeConstraints(state.protagonist.background ?? '', draft.userInput)) {
    requireData((['year', 'month', 'day', 'hour', 'minute', 'second'] as const).every((key) => constraint[key] === undefined || constraint[key] === calendar[key])
      && (!constraint.season || months[constraint.season].includes(calendar.month)) && periodMatches(constraint.period, calendar.hour),
      'OPENING_TIME', '开局时间违反玩家明确指定的日期、季节或时段。');
  }
  const evidence = entries[0].textEvidence;
  requireData(typeof evidence === 'string' && evidence.trim() && draft.story?.narrative.includes(evidence), 'OPENING_TIME', '开局时间缺少正文依据。');
  // 只校验开局时间锚点的明确日历陈述，不扫描全文中的回忆或要求普通正文写时间。
  const dates = [...evidence.matchAll(/(\d{4})[年-](\d{1,2})[月-](\d{1,2})(?:日|号)?/g)];
  requireData(dates.length > 0 && dates.every((date) => Number(date[1]) === calendar.year && Number(date[2]) === calendar.month && Number(date[3]) === calendar.day
    && !isNegatedFact(evidence, date.index, date.index + date[0].length)),
    'OPENING_TIME', '开局时间依据须包含与起点一致的完整日期。');
  const weekdays = evidence.match(/星期[一二三四五六日天]/g) ?? [];
  requireData(weekdays.every((value) => value.replace('天', '日') === calendar.weekday), 'OPENING_TIME', '开局日期与星期不一致。');
  const clocks = [...evidence.matchAll(/(?<![\d+-])(\d{1,2}):(\d{2})(?::(\d{2}))?/g)];
  requireData(clocks.every((clock) => Number(clock[1]) === calendar.hour && Number(clock[2]) === calendar.minute
    && (!clock[3] || Number(clock[3]) === new Date(startAt).getUTCSeconds())), 'OPENING_TIME', '开局时刻与正文不一致。');
  requireData((evidence.match(/春天|春季|夏天|夏季|秋天|秋季|冬天|冬季/g) ?? []).every((season) => months[season[0]].includes(calendar.month))
    && (evidence.match(/凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/g) ?? []).every((period) => periodMatches(period, calendar.hour)),
    'OPENING_TIME', '开局季节或昼夜与正文时间依据不一致。');
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
  return { status: 'pending', playerConstraints: openingTimeConstraints(state.protagonist.background ?? '', input),
    policy: '玩家明确的年代/日期/季节优先；无设定时由本次开局正文自行合理安排，不使用设备或模型当前日期。含糊相对时间须澄清，不推定现实年份。',
    guideContract: '同一次正文输出在变量规划给出唯一group=time, subjectHint=time:opening, observedFact=JSON.stringify({startAt,endAt})，均为合法ISO +08:00。startAt是开场起点，endAt是按已发生行动估算的本幕结束，必须大于startAt，无固定耗时。textEvidence逐字引用正文中交代开场完整年月日的时间锚点；若锚点有星期/钟点/季节/昼夜须一致。时代和天气保持现实一致。变量阶段核验后SetWorldClock=endAt，不重复加耗时。标记仅是待确认，不能作已经结算的世界事实。' };
}
