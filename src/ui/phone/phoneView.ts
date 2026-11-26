import type { GameState } from '../../domain/state';
import { chinaCalendar } from '../../domain/openingTime';
import { activeMembers } from '../../domain/harem/schema';
import { factionView } from '../panels/factionView';
import { money } from '../panels/playerView';
import type { PlayerView } from '../panels/playerView';

export function phoneMoney(cents: number | null) {
  return cents === null ? money(null) : '¥' + money(cents).replace(/ 元$/, '');
}

export function phoneDate(time: string) {
  const date = chinaCalendar(time);
  return date.month + '月' + date.day + '日';
}

export function phoneDateTime(at: string) {
  const { hour, minute } = chinaCalendar(at);
  return phoneDate(at) + ' ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

const dayMs = 86_400_000;
const gameDay = (time: string) => Math.floor((Date.parse(time) + 8 * 3_600_000) / dayMs);
export const loanReminderDays = 3;

export function upcomingLoans(state: GameState) {
  if (state.openingTimePending) return [];
  const today = gameDay(state.worldClock);
  return Object.values(state.economy.debts)
    .flatMap((debt) => {
      if (debt.status !== 'active' || !debt.dueAt || debt.outstanding === 0) return [];
      const days = gameDay(debt.dueAt) - today;
      return [
        {
          debt,
          dueAt: debt.dueAt,
          days,
          key: JSON.stringify([state.saveId, state.createdAt, debt.id, Date.parse(debt.dueAt)]),
          deadline: days === 0 ? '今日到期' : days < 0 ? '已逾期 ' + -days + ' 天' : days + ' 天后到期',
        },
      ];
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.debt.id.localeCompare(b.debt.id));
}

export function contactGroups(view: PlayerView) {
  const harem = new Set(view.harem ? activeMembers(view.harem).map((m) => m.id) : []);
  // playerView has already removed undisclosed parentage. Use the same public membership as the dossier.
  const children = new Set(view.harem?.children.map((row) => row.childNpcId));
  const parents = new Set(view.harem?.children.map((row) => row.parentNpcId));
  const org = factionView(view);
  const members = new Set(
    org && [...org.otherPeople, ...org.departments.flatMap((d) => d.people)].map((p) => p.id),
  );
  const groups: Record<'家人' | '后宫' | '我的势力' | '其他', PlayerView['npc']> = {
    家人: [],
    后宫: [],
    我的势力: [],
    其他: [],
  };
  for (const p of view.npc) {
    if (p.phoneContact?.status !== 'known' && p.phoneContact?.status !== 'invalid') continue;
    const group = children.has(p.id)
      ? '家人'
      : harem.has(p.id)
        ? '后宫'
        : parents.has(p.id)
          ? '家人'
          : members.has(p.id)
            ? '我的势力'
            : '其他';
    groups[group].push(p);
  }
  return groups;
}
