import { GameTimeSchema, requireData } from './common';
import type { GameState } from './state';
import type { TurnDraft } from './drafts';
import type { DomainCommand } from './commands';
import { isNegatedFact } from './factPolarity';

const hour = 3600000, day = 24 * hour, china = 8 * hour;
const stamp = (ms: number) => new Date(ms + china).toISOString().replace(/\.000Z$/, '+08:00').replace(/Z$/, '+08:00');
const digits = '[零〇一二两三四五六七八九十百0-9.]+';
function number(text: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const values: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text.length === 1 && text in values) return values[text];
  if (!/^[一二两三四五六七八九]?百(?:[零〇]?[一二两三四五六七八九]?十)?[零〇]?[一二两三四五六七八九]?$|^[一二两三四五六七八九]?十[一二两三四五六七八九]?$/.test(text)) return undefined;
  let total = 0, digit = 0;
  for (const ch of text) {
    if (ch === '百' || ch === '十') { total += (digit || 1) * (ch === '百' ? 100 : 10); digit = 0; }
    else digit = values[ch];
  }
  return total + digit;
}
type ActionKind = 'sleep' | 'rest' | 'wait' | 'travel' | 'work' | 'none';
interface Intent {
  actionKind: ActionKind;
  resolution: 'exact' | 'estimated' | 'unknown' | 'none';
  targetAt?: string;
  endWindow?: { from: string; to: string };
}
function timeIntent(clock: string, action: string): Intent {
  const now = Date.parse(clock), local = new Date(now + china);
  const matches = [...action.matchAll(/睡觉|睡眠|睡|休息|休养|等候|等待|等|旅行|乘车|坐车|开车|行驶|坐火车|乘火车|步行|赶路|飞行|工作|上班/g)];
  const live = matches.filter((m) => !isNegatedFact(action, m.index, m.index + m[0].length) &&
    !/(?:不|别|不要|不能|不会|不想|不愿|取消)(?:再|继续)?\s*$/.test(action.slice(0, m.index)) &&
    !/(?:如果|假如|假设|回忆|曾经|听说|昨天|明天|后天)[^。！？；\n]*$/.test(action.slice(0, m.index)));
  if (!live.length) return { actionKind: 'none', resolution: 'none' };
  const kind = (verb: string): ActionKind => /睡/.test(verb) ? 'sleep' : /休/.test(verb) ? 'rest' : /等/.test(verb) ? 'wait' : /工作|上班/.test(verb) ? 'work' : 'travel';
  const actionKind = kind(live[0][0]), unknown: Intent = { actionKind, resolution: 'unknown' };
  if (/[吗么呢？?]\s*$/.test(action)) return unknown;
  if (new Set(live.map((m) => kind(m[0]))).size !== 1) return unknown; // 多段行动不擅自相加。
  const finish = (at: number, estimated = false): Intent => {
    if (!Number.isFinite(at) || at < now || !Number.isSafeInteger(at) || at + china > 253402300799000) return unknown;
    return estimated ? { actionKind, resolution: 'estimated', endWindow: { from: clock, to: stamp(at) } }
      : { actionKind, resolution: 'exact', targetAt: stamp(at) };
  };
  const untilMatch = action.match(/(?:直到|到|至)([\s\S]+)$/);
  if (untilMatch?.index !== undefined && untilMatch.index < live[0].index) return unknown;
  const until = untilMatch?.[1];
  // “第二天”是目标日期，不能从中截出“二天”误当作持续48小时。
  const durationText = until && !new RegExp(`^\\s*(${digits}|半)\\s*(?:个)?(?:小时|分钟|天|周)后\\s*$`).test(until) ? ''
    : action.replace(new RegExp(`(${digits})个半小时`, 'g'), (original, value: string) => { const n = number(value); return n === undefined ? original : `${n + 0.5}小时`; });
  const duration = [...durationText.matchAll(new RegExp(`(${digits}|半)\\s*(?:个)?\\s*(小时|分钟|天|周)(?:左右)?`, 'g'))];
  if (duration.length === 1 && !new RegExp(`个半|(${digits})\\s*[到至~～—-]\\s*(${digits})`).test(durationText)) {
    const amount = duration[0][1] === '半' ? 0.5 : number(duration[0][1]);
    if (amount !== undefined && amount > 0) return finish(now + amount * ({ 小时: hour, 分钟: 60000, 天: day, 周: day * 7 }[duration[0][2]] ?? 0), /大约|大概|预计|估计|差不多|左右/.test(action));
  }
  if (duration.length) return unknown;
  if (!until) return unknown;
  const iso = until.trim().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/);
  if (iso) return GameTimeSchema.safeParse(iso[0]).success ? finish(Date.parse(iso[0])) : unknown;
  const absolute = until.match(/^(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:日|号)?[T\s]*(\d{1,2}):(\d{2})/);
  if (absolute) {
    const [, y, m, d, h, min] = absolute;
    const value = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:00+08:00`;
    return GameTimeSchema.safeParse(value).success ? finish(Date.parse(value)) : unknown;
  }
  const days = /后天/.test(until) ? 2 : /明天|明早|次日|次晨|翌日|第二天/.test(until) ? 1 : 0;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - china;
  const clockMatch = until.match(new RegExp(`(${digits})(?::([0-9]{2})|点(?:(半)|(${digits})分)?)`));
  if (clockMatch) {
    let h = number(clockMatch[1]); const min = clockMatch[2] ? Number(clockMatch[2]) : clockMatch[3] ? 30 : clockMatch[4] ? number(clockMatch[4]) : 0;
    if (h === undefined || min === undefined || !Number.isInteger(h) || !Number.isInteger(min) || min < 0 || min > 59 || h > 23 || h < 0) return unknown;
    if (/下午|晚上|今晚|傍晚/.test(until) && h < 12) h += 12;
    if (/凌晨/.test(until) && h === 12) h = 0;
    let at = midnight + days * day + h * hour + min * 60000;
    if (!days && at < now && !/今天|今日/.test(until)) at += day;
    return finish(at);
  }
  if (/早上|早晨|明早|次晨/.test(until)) {
    const offset = days || (local.getUTCHours() >= 6 ? 1 : 0);
    return { actionKind, resolution: 'estimated', endWindow: { from: stamp(midnight + offset * day + 6 * hour), to: stamp(midnight + offset * day + 12 * hour) } };
  }
  return unknown;
}
export interface TimeCandidate { id: string; at: string; title: string; channel: 'door' | 'communication' | 'obstruction' | 'appointment'; conditional: true }
function completed(state: GameState, ref: string) {
  const task = state.tasks[ref] ?? state.tasks[ref.replace(/^task:/, '')];
  const event = state.events[ref] ?? state.events[ref.replace(/^event:/, '')];
  return task?.status === 'completed' || event?.status === 'resolved';
}
export function timePreflight(state: GameState, action: string) {
  const intent = timeIntent(state.worldClock, action), end = intent.targetAt ?? intent.endWindow?.to;
  const candidates: TimeCandidate[] = [];
  if (end) for (const event of Object.values(state.events)) {
    if (event.visibility !== 'known' || !['scheduled', 'active'].includes(event.status) ||
      Date.parse(event.startAt) < Date.parse(state.worldClock) || Date.parse(event.startAt) > Date.parse(end) ||
      ![...event.prerequisites, ...event.blockers].every((ref) => completed(state, ref))) continue;
    if (event.linkedTaskIds.some((id) => { const task = state.tasks[id]; return !task || ['blocked', 'cancelled'].includes(task.status) ||
      Date.parse(task.startAt) > Date.parse(event.startAt) || ![...task.prerequisites, ...task.blockers].every((ref) => completed(state, ref)); })) continue;
    if (state.journal.some((entry) => entry.story.variableGuide.some((guide) => guide.group === 'time' &&
      guide.subjectHint === `time:interrupt:${event.id}` && Date.parse(guide.observedFact) === Date.parse(event.startAt) &&
      guide.textEvidence?.trim() && entry.story.narrative.includes(guide.textEvidence)))) continue;
    const own = event.actorRefs.some((ref) => ref.kind === 'protagonist' && ref.id === state.protagonist.id);
    const sameScene = event.locationId === state.protagonist.locationId && Boolean(state.locations[state.protagonist.locationId]?.parentId);
    const rules = [
      ['door', /敲门|门铃|上门|到访|来访/, own && sameScene && intent.actionKind !== 'travel'],
      ['communication', /来电|电话|通话|短信|通讯|消息|通知/, own],
      ['obstruction', /封路|封闭|停运|航班取消|取消航班|受阻|阻断|事故|警报|火警/, sameScene && (own || event.impact === 'major')],
      ['appointment', /预约|约定|会面|到场/, own && sameScene && intent.actionKind !== 'travel'],
    ] as const;
    const channel = rules.find(([, pattern, eligible]) => { const match = event.title.match(pattern); return eligible && match && !isNegatedFact(event.title, match.index, match.index! + match[0].length); })?.[0];
    if (channel) candidates.push({ id: event.id, at: event.startAt, title: event.title, channel, conditional: true });
  }
  candidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return { ...intent, from: state.worldClock, locationId: state.protagonist.locationId, candidates,
    policy: '这是条件候选，不是已经发生或必然中断。需有实际敲门/声音/可及时获知通讯/直接阻碍的正文事实；不能因到期自动完成，不代替玩家接受或回应。没有实际中断可继续原行动。时间只由后续变量候选及正式事务提交。',
    guideContract: '明确/有界长行动须在变量规划给出一条group=time，subjectHint=time:end（完成）、time:pause（其他真实原因提前停下）或time:interrupt:<候选id>；observedFact填写本轮实际停止时间ISO（+08:00），textEvidence引用正文既成事实。中断只能停在候选时间，不能先到终点再回写。估计不是保证抵达，可在窗口内交还控制权；早晨6至12点仅为估计语义范围，不是固定唤醒时间。' };
}
export function timeOutcome(state: GameState, draft: Pick<TurnDraft, 'userInput' | 'turnKind' | 'story'>, required = false) {
  if (draft.turnKind !== 'regular' || !draft.story) return undefined;
  const plan = timePreflight(state, draft.userInput), end = plan.targetAt ?? plan.endWindow?.to;
  const guides = draft.story.variableGuide.filter((guide) => guide.group === 'time' && guide.subjectHint?.startsWith('time:'));
  if (!end && !guides.length) return undefined;
  if (!guides.length && !required) return undefined; // 旧正文仍可读；没有新预检记录不伪造中断。
  requireData(end && guides.length === 1, 'TIME_PREFLIGHT', '长行动缺少唯一的实际停止时间，请重新生成正文');
  const guide = guides[0], at = Date.parse(guide.observedFact), evidence = guide.textEvidence;
  requireData(GameTimeSchema.safeParse(guide.observedFact).success && at >= Date.parse(plan.from) && at <= Date.parse(end) &&
    typeof evidence === 'string' && evidence.trim() && draft.story.narrative.includes(evidence), 'TIME_PREFLIGHT', '时间结果或正文依据无效');
  if (guide.subjectHint === 'time:end') requireData(plan.targetAt ? at === Date.parse(plan.targetAt) : at >= Date.parse(plan.endWindow!.from), 'TIME_PREFLIGHT', '实际结束时间不在目标范围');
  else if (guide.subjectHint === 'time:pause') requireData(at < Date.parse(end), 'TIME_PREFLIGHT', '提前停下必须早于目标结束');
  else requireData(plan.candidates.some((candidate) => guide.subjectHint === `time:interrupt:${candidate.id}` && at === Date.parse(candidate.at)), 'TIME_PREFLIGHT', '中断事件已失效或不具备触达条件');
  return { at: guide.observedFact, evidence };
}
export function validateTimeCommands(state: GameState, draft: TurnDraft, commands: readonly DomainCommand[]) {
  if (draft.turnKind !== 'regular') return;
  const outcome = timeOutcome(state, draft), plan = timePreflight(state, draft.userInput), end = outcome?.at ?? plan.targetAt ?? plan.endWindow?.to;
  if (!end) return;
  const clocks = commands.filter((command) => command.type === 'SetWorldClock');
  requireData(clocks.every((command) => Date.parse(command.worldClock) <= Date.parse(end)), 'TIME_PREFLIGHT', '时钟越过本轮实际停止时间');
  if (outcome) requireData((clocks.length ? Date.parse(clocks.at(-1)!.worldClock) : Date.parse(state.worldClock)) === Date.parse(outcome.at), 'TIME_PREFLIGHT', '变量时间与正文停止时间不一致');
  return outcome;
}
