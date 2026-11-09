import type { DomainCommand } from '../../domain/commands';
import type { Chronicle } from '../../domain/history/schema';
import type { HistoryTime } from '../../domain/history/time';
import type { TimelineEntry } from '../../domain/events/schema';
import { gameTime } from './game';
export function chronicle(id = 'milestone-one', time: HistoryTime = { precision: 'instant', at: gameTime }): Chronicle {
  return { category: 'protagonist', nature: 'fact', milestoneId: id, time, narrative: '林舟正式决定创办社区阅览室，将多年构想付诸行动。',
    process: ['与伙伴确定了分工。'], results: [{ text: '作出创业决定。', nature: 'fact' }],
    impacts: [{ text: '开始承担筹备职责。', nature: 'fact' }] };
}
export function historyCommand(id = 'history-one', value = chronicle()): Extract<DomainCommand, { type: 'RecordHistory' }> {
  return { type: 'RecordHistory', commandId: `record-${id}`, evidence: '本幕形成历史事实',
    entry: { id, title: '决定创办阅览室', summary: '林舟与伙伴确定筹备方向。', knowledgeKind: 'established', actorRefs: [], relatedEntryIds: [], chronicle: value } };
}
export function historyEntry(id: string, value = chronicle(id)): TimelineEntry {
  return { ...historyCommand(id, value).entry, recordedAt: gameTime, sourceTurnId: 'turn-a' };
}

/** Fictional display fixture. No player conversation or save data. */
export function historyDisplayCommands(extra = 0) {
  const make = (id: string, title: string, time: HistoryTime, world = false, milestone = id) => {
    const base = chronicle(milestone, time);
    const command = historyCommand(id, world ? { ...base, category: 'world', scope: 'region', scopeText: '临江地区', basis: 'historical_event', endTime: time } : base);
    command.entry.title = title;
    command.entry.summary = world ? '地区公共阅览网络建成，旧城居民获得新的文化空间。' : '林舟与伙伴作出重要选择，生活由此进入新阶段。';
    command.entry.occurredTimeText = '地方档案所记原始时间';
    command.entry.chronicle!.narrative = '是年，旧城新设阅览之所。众人分工募书、修缮旧屋，历经数月方告完成。\n后续的运营与人员安排仍继续推进。';
    return command;
  };
  const rows = [
    make('beginning', '立志兴学', { precision: 'year', year: 2020 }),
    make('summer', '夏日约定', { precision: 'season', year: 2021, season: 'summer' }),
    make('world-opening', '临江阅览网络建成', { precision: 'day', date: '2021-12-10' }, true, 'opening-day'),
    make('hero-opening', '正式就任馆长', { precision: 'day', date: '2021-12-10' }, false, 'opening-day'),
    make('december', '冬月学社成立', { precision: 'month', year: 2021, month: 12 }, true),
    make('winter', '冬季迁居', { precision: 'season', year: 2021, season: 'winter' }),
    make('year', '获授年度荣誉', { precision: 'year', year: 2021 }),
    make('next-year', '新年履职', { precision: 'day', date: '2022-01-01' }),
    make('unknown', '早年求学', { precision: 'unknown', text: '少年求学期间，年份待考' }),
  ];
  rows[3].entry.chronicle!.relations = [{ kind: 'parallel', entryId: 'world-opening' }];
  for (let i = 0; i < extra; i++) rows.push(make(`extra-${i}`, `地方纪事第${i}则`, { precision: 'day', date: `2023-${String(1 + Math.floor(i / 28) % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}` }, i % 2 === 0));
  const ordinary = historyCommand('old-report'); delete ordinary.entry.chronicle;
  ordinary.entry.title = '来访者谈及大学往事'; ordinary.entry.occurredTimeText = '大学时期'; ordinary.entry.knowledgeKind = 'reported';
  return [...rows, ordinary];
}

/** All declared world scopes, one paired protagonist node and an ordinary source. */
export function historyScopeDisplayCommands() {
  const scopes = ['region', 'country', 'world', 'organization'] as const;
  const titles = ['临江文化设施建成', '全国公共馆藏协作完成', '跨国典籍修复工程告成', '学社联合馆藏工程完成并正式向各地读者开放'];
  const rows = scopes.map((scope, index) => {
    const time: HistoryTime = { precision: 'day', date: `2021-12-${10 + index}` };
    const command = historyCommand(`scope-${scope}`, { ...chronicle(`scope-${scope}`, time), category: 'world', scope,
      scopeText: '合成纪事所载范围', basis: 'historical_event', endTime: time });
    command.entry.title = titles[index]; command.entry.summary = '工程实际完成，后续文化事业继续发展。';
    return command;
  });
  const hero = historyCommand('scope-hero', chronicle('scope-region', { precision: 'day', date: '2021-12-10' }));
  hero.entry.title = '正式担任阅览室负责人'; hero.entry.chronicle!.relations = [{ kind: 'parallel', entryId: 'scope-region' }];
  const ordinary = historyDisplayCommands().find(row => row.entry.id === 'old-report')!;
  // Deliberately unordered input: scope and category must not determine the axis index.
  return [rows[3], hero, rows[1], ordinary, rows[0], rows[2]];
}
