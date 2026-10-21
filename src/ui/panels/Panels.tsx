import { useState } from 'react';
import type { ReactNode } from 'react';
import { Detail, Empty } from '../Dialog';
import { categoryLabels, dateTime, orgLabels } from './playerView';
import type { PlayerView } from './playerView';
import { MemoryPanel } from './MemoryPanel';

export const panelNames = [
  'NPC',
  '势力组织',
  '地图',
  '物品栏',
  '世界事件',
  '历史时间轴',
  '记忆',
] as const;
export type PanelName = (typeof panelNames)[number];
const eventStatuses = {
  scheduled: '计划中',
  active: '进行中',
  resolved: '已完成',
  blocked: '受阻',
  cancelled: '已取消',
};

export function Panels({ name, view }: { name: PanelName; view: PlayerView }) {
  const [query, setQuery] = useState('');
  const [personId, setPersonId] = useState<string>();
  if (name === 'NPC') {
    const selected = view.npc.find((p) => p.id === personId);
    return (
      <>
        <p className="muted">人物档案与创角设定。好感倾向不代表恋爱关系。</p>
        <label className="search">
          搜索人物
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入姓名" />
        </label>
        <div className="archive-split">
          <div>
            {(['special', 'ordinary'] as const).map((kind) => (
              <section key={kind}>
                <h3>{kind === 'special' ? '特殊 NPC' : '普通 NPC'}</h3>
                {view.npc
                  .filter((p) => p.kind === kind && p.name.includes(query))
                  .map((person) => (
                    <button
                      className="person-row"
                      aria-pressed={personId === person.id}
                      key={person.id}
                      onClick={() => setPersonId(person.id)}
                    >
                      <span className="avatar">{person.name.slice(0, 1)}</span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.relationshipText ? '创角关系设定' : '关系尚未公开'}</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                {!view.npc.some((p) => p.kind === kind && p.name.includes(query)) && (
                  <Empty>暂无符合条件的人物</Empty>
                )}
              </section>
            ))}
          </div>
          <section className="card">
            {selected ? (
              <>
                <span className="tag">
                  {selected.profile ? '创角设定 · 非当前关系判定' : '人物档案'}
                </span>
                <h3>{selected.name}</h3>
                <dl>
                  <Detail label="身份">{selected.identity || '尚未了解'}</Detail>
                  <Detail label={selected.profile ? '创角关系设定' : '与主角关系'}>
                    {selected.relationshipText || '尚未公开'}
                  </Detail>
                  <Detail label="关系倾向">
                    {selected.affinity === null ? '尚未确认' : selected.affinity}
                  </Detail>
                  <Detail label="当前位置">
                    {selected.onScene
                      ? view.locations.find((p) => p.id === selected.locationId)?.name || '当前场景'
                      : '当前去向未知'}
                  </Detail>
                  {selected.profile && (
                    <>
                      <Detail label="年龄">{selected.profile.age ?? '未填写'}</Detail>
                      <Detail label="外貌">{selected.profile.appearance}</Detail>
                      <Detail label="性格">{selected.profile.temperament}</Detail>
                      <Detail label="能力">{selected.profile.skills.join('、')}</Detail>
                      <Detail label="个人经历">{selected.profile.background}</Detail>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <Empty>选择人物，查看已知资料。</Empty>
            )}
          </section>
        </div>
      </>
    );
  }
  if (name === '势力组织')
    return (
      <>
        <p className="muted">展示主角已知的组织及关系；内部计划与非公开事务不会在此展开。</p>
        <div className="two-grid">
          {Object.entries(orgLabels).map(([kind, label]) => (
            <section className="card" key={kind}>
              <h3>{label}</h3>
              {view.organizations
                .filter((o) => o.kind === kind)
                .map((org) => (
                  <article className="entry" key={org.id}>
                    <h4>{org.name}</h4>
                    <p>与主角关系尚未公开</p>
                  </article>
                ))}
              {!view.organizations.some((o) => o.kind === kind) && <Empty>尚无已知组织</Empty>}
            </section>
          ))}
        </div>
      </>
    );
  if (name === '地图') {
    const branch = (parent?: string): ReactNode => (
      <ul className="map-tree">
        {view.locations
          .filter((p) => p.parentId === parent)
          .map((place) => (
            <li key={place.id}>
              <span>⌖ {place.name}</span>
              {branch(place.id)}
            </li>
          ))}
      </ul>
    );
    return (
      <>
        <p className="muted">已知地点 · 地理层级随旅程扩展，尚未记录的街区不作推定。</p>
        <section className="map-surface">{branch()}</section>
      </>
    );
  }
  if (name === '物品栏')
    return (
      <>
        {view.items.length ? (
          <div className="two-grid">
            {view.items.map((item) => (
              <article className="card" key={item.id}>
                <span className="tag">{categoryLabels[item.category]}</span>
                <h3>{item.name}</h3>
                <dl>
                  <Detail label="数量">{item.quantity}</Detail>
                  <Detail label="位置">
                    {view.locations.find((p) => p.id === item.locationId)?.name || '主角持有'}
                  </Detail>
                  <Detail label="状态">{item.conditionText || '未记录'}</Detail>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <Empty>暂无已登记的重要物品。开局确认后，拥有的物品会显示在这里。</Empty>
        )}
      </>
    );
  if (name === '世界事件')
    return (
      <>
        {view.events.length ? (
          view.events.map((event) => (
            <article className="card entry" key={event.id}>
              <span className="tag">{eventStatuses[event.status]}</span>
              <h3>{event.title}</h3>
              <p>{dateTime(event.startAt)}</p>
              {event.resolutionText && <p>{event.resolutionText}</p>}
            </article>
          ))
        ) : (
          <Empty>暂无主角已知的事件。</Empty>
        )}
      </>
    );
  if (name === '历史时间轴')
    return (
      <>
        {view.timeline.length ? (
          <ol className="timeline">
            {view.timeline.map((entry) => (
              <li key={entry.eventId}>
                <time>{dateTime(entry.occurredAt)}</time>
                <h3>{entry.title}</h3>
                <p>{entry.summary}</p>
                <p>结局：{entry.outcome}</p>
                {entry.longTermImpact && <p>影响：{entry.longTermImpact}</p>}
                <small>来源回合：{entry.sourceTurnIds.join('、') || '未记录'}</small>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>重大事件在结案并被主角获知后，才会进入历史。</Empty>
        )}
      </>
    );
  return <MemoryPanel view={view} />;
}
