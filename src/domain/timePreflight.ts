import { z } from 'zod';
import { openingTimeSelection } from './openingTime';
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
  requireData(!state.openingTimePending, 'OPENING_TIME', '尚未确定开局时间，不能执行普通时间预检');
  const intent = timeIntent(state.worldClock, action), end = intent.targetAt ?? intent.endWindow?.to;
  const candidates: TimeCandidate[] = [];
  if (end) for (const event of Object.values(state.events)) {
    if (event.visibility !== 'known' || !['scheduled', 'active'].includes(event.status) ||
      Date.parse(event.startAt) < Date.parse(state.worldClock) || Date.parse(event.startAt) > Date.parse(end) ||
      ![...event.prerequisites, ...event.blockers].every((ref) => completed(state, ref))) continue;
    if (event.linkedTaskIds.some((id) => { const task = state.tasks[id]; return !task || ['blocked', 'cancelled'].includes(task.status) ||
      Date.parse(task.startAt) > Date.parse(event.startAt) || ![...task.prerequisites, ...task.blockers].every((ref) => completed(state, ref)); })) continue;
    if (state.journal.some((entry) => entry.story.variableGuide.some((guide) => guide.group === 'time' &&
      guide.subjectHint === `time:interrupt:${event.id}` && Date.parse(guide.observedFact) === Date.parse(event.startAt)))) continue;
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
    guideContract: '明确/有界长行动须在变量规划给出一条group=time，subjectHint=time:end（完成）、time:pause（其他真实原因提前停下）或time:interrupt:<候选id>；observedFact填写本轮实际停止时间ISO（+08:00），textEvidence简述实际行动或停止原因，可概括而无需逐字引用。中断只能停在候选时间，不能先到终点再回写。估计不是保证抵达，可在窗口内交还控制权；早晨6至12点仅为估计语义范围，不是固定唤醒时间。' };
}
// 语义分类由同一次正文请求完成；程序验证人物和两段玩家原请求来源，不解析小说文风。
const HistoricalPerspectiveSchema = z.strictObject({
  npcId: z.string().min(1),
  perspectiveRequest: z.string().trim().min(1),
  pastRequest: z.string().trim().min(1),
  temporalScope: z.literal('past_only'),
  currentPlotAdvances: z.literal(false),
});
export function historicalPerspective(state: GameState, draft: Pick<TurnDraft, 'userInput' | 'turnKind' | 'story'>) {
  const records = draft.story?.variableGuide.filter((guide) => guide.group === 'time' && guide.subjectHint === 'time:retrospective') ?? [];
  if (!records.length) return undefined;
  requireData(records.length === 1, 'TIME_PREFLIGHT', '历史视角声明无效');
  let raw: unknown;
  try { raw = JSON.parse(records[0].observedFact); } catch { requireData(false, 'TIME_PREFLIGHT', '历史视角声明不是合法JSON'); }
  const parsed = HistoricalPerspectiveSchema.safeParse(raw);
  requireData(parsed.success, 'TIME_PREFLIGHT', '历史视角必须是玩家明确要求的纯过去回顾');
  const proof = parsed.data, npc = state.npc[proof.npcId];
  requireData(npc && proof.npcId !== state.protagonist.id &&
    [npc.id, npc.name, ...npc.aliases].some((name) => proof.perspectiveRequest.includes(name)) &&
    proof.perspectiveRequest !== proof.pastRequest &&
    draft.userInput.includes(proof.perspectiveRequest) && draft.userInput.includes(proof.pastRequest),
    'TIME_PREFLIGHT', '历史视角缺少人物或玩家原请求的独立依据');
  requireData(!draft.story?.variableGuide.some((guide) => guide.group === 'time' &&
    guide.subjectHint?.startsWith('time:') && guide.subjectHint !== 'time:retrospective'),
    'TIME_PREFLIGHT', '过去回顾不能混合当前时间推进');
  return proof;
}
export const turnTimePolicy = {
  normal: '世界时钟采用合法结构化候选。待定开局以Story的OPENING_TIME为唯一时钟候选，由程序统一应用，变量无需重复SetWorldClock。普通回合由变量AI根据实际行动合理估时，允许零耗时，无固定步长，不要求正文写出时间或逐字证据。只能前进或保持，不能倒退。明确中断不能越过实际停止点；预计时间不证明事件已经发生。',
  retrospective: '纯历史视角属于只读当前世界的特殊语义，并非零耗时的必要条件：玩家明确要求其他已有NPC视角，且只回顾此前发生的事。正文在变量规划用group=time、subjectHint=time:retrospective，observedFact为JSON：{npcId,perspectiveRequest,pastRequest,temporalScope:"past_only",currentPlotAdvances:false}。两段Request分别完整引用玩家要求切换人物和回顾过去的不同原文，不能引用AI自插回忆；textEvidence可概括回顾内容，无需逐字引用。当前人物视角、NPC讲往事、现在的其他人物视角、过去与现在混合均不适用；不明确时按普通时间规则处理，可零耗时但不可倒退。纯回顾不更新任何当前事实或推演世界，仍遵守既有事实和NPC认知边界，不授予私有知识。',
};
export function timeOutcome(state: GameState, draft: Pick<TurnDraft, 'userInput' | 'turnKind' | 'story'>, _required = false) {
  void _required;
  if (!draft.story) return undefined;
  if (state.openingTimePending) {
    const selected = openingTimeSelection(state, draft)!;
    return { at: selected.endAt, evidence: selected.evidence };
  }
  if (historicalPerspective(state, draft)) return undefined;
  if (draft.turnKind !== 'regular') return undefined;
  const plan = timePreflight(state, draft.userInput), end = plan.targetAt ?? plan.endWindow?.to;
  const guides = draft.story.variableGuide.filter((guide) => guide.group === 'time' && guide.subjectHint?.startsWith('time:'));
  if (!guides.length) return undefined; // 预检是建议；不以遗漏文字规划阻断普通正文。
  requireData(guides.length === 1, 'TIME_PREFLIGHT', '时间结果不唯一');
  const guide = guides[0], at = Date.parse(guide.observedFact), evidence = guide.textEvidence;
  requireData(GameTimeSchema.safeParse(guide.observedFact).success && at >= Date.parse(plan.from),
    'TIME_PREFLIGHT', '时间结果非法或倒退');
  if (guide.subjectHint?.startsWith('time:interrupt:'))
    requireData(end && at <= Date.parse(end) && plan.candidates.some((candidate) => guide.subjectHint === `time:interrupt:${candidate.id}` && at === Date.parse(candidate.at)),
      'TIME_PREFLIGHT', '中断事件已失效或不具备触达条件');
  else requireData(guide.subjectHint === 'time:end' || guide.subjectHint === 'time:pause', 'TIME_PREFLIGHT', '未知时间结果类型');
  return { at: guide.observedFact, evidence };
}
export function validateTimeCommands(state: GameState, draft: TurnDraft, commands: readonly DomainCommand[]) {
  const opening = openingTimeSelection(state, draft);
  if (opening) {
    requireData(commands.filter((c) => c.type === 'SetWorldClock').every((c) => Date.parse(c.worldClock) === Date.parse(opening.endAt)),
      'OPENING_TIME', '变量时钟与Story开局候选冲突');
    return;
  }
  if (historicalPerspective(state, draft)) {
    requireData(commands.every((command) => command.type === 'SetWorldClock' && Date.parse(command.worldClock) === Date.parse(state.worldClock)),
      'TIME_PREFLIGHT', '历史回顾不能更改当前世界或时钟');
    return;
  }
  // 只保护明确结构化中断上界，不从小说关键词推算必须经过多少秒。
  if (draft.story?.variableGuide.some((g) => g.subjectHint?.startsWith('time:interrupt:'))) {
    const outcome = timeOutcome(state, draft);
    requireData(!outcome || commands.filter((c) => c.type === 'SetWorldClock').every((c) => Date.parse(c.worldClock) <= Date.parse(outcome.at)),
      'TIME_PREFLIGHT', '时钟越过实际中断停止点');
  }
}

export function validateHistoricalWorld(state: GameState, draft: TurnDraft, result: NonNullable<TurnDraft['world']>['result']) {
  if (!historicalPerspective(state, draft)) return;
  requireData([result.worldCommands, result.taskCommands, result.eventCommands, result.futureEvents,
    result.visibleHooks, result.timelineCandidates].every((entries) => entries.length === 0),
    'TIME_PREFLIGHT', '纯历史视角不能执行当前动态世界结算');
}
export function validateCommittedTime(state: GameState, draft: TurnDraft) {
  const commands = draft.variables?.result.commands ?? [];
  validateTimeCommands(state, draft, commands);
  if (draft.world) validateHistoricalWorld(state, draft, draft.world.result);
  // 非法日期/倒退由严格命令Schema与同一正式基线的确定性模拟校验；不再要求正向步长。
}
