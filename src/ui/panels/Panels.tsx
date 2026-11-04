import { useState } from 'react';
import type { ReactNode } from 'react';
import { Detail, Empty } from '../Dialog';
import { categoryLabels, dateTime, orgLabels } from './playerView';
import type { PlayerView } from './playerView';
import { MemoryPanel } from './MemoryPanel';
import { WorldRecord, RecordList } from './WorldRecord';
import { MemoryRecord } from './MemoryRecord';

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
  const [personPage, setPersonPage] = useState(0);
  if (name === 'NPC') {
    const selected = view.npc.find((p) => p.id === personId);
    const matches = view.npc.filter(person => [person.name, person.identity, person.relationshipText].some(text => text?.includes(query)));
    const page = Math.min(personPage, Math.max(0, Math.ceil(matches.length / 20) - 1));
    const people = matches.slice(page * 20, (page + 1) * 20);
    return (
      <>
        <p className="muted">玩家可只读查看全部人物。查看不会让主角或其他人物获得新知识；好感倾向不代表恋爱关系。</p>
        <label className="search">
          搜索人物
          <input value={query} maxLength={4000} onChange={(e) => { setQuery(e.target.value); setPersonPage(0); }} placeholder="输入姓名、身份或关系" />
        </label>
        {matches.length > 20 && <div className="memory-pagination"><button disabled={!page} onClick={() => setPersonPage(page - 1)}>上一页人物</button><span>第 {page + 1} 页</span><button disabled={(page + 1) * 20 >= matches.length} onClick={() => setPersonPage(page + 1)}>下一页人物</button></div>}
        <div className="archive-split">
          <div>
            {(['special', 'ordinary'] as const).map((kind) => (
              <section key={kind}>
                <h3>{kind === 'special' ? '特殊 NPC' : '普通 NPC'}</h3>
                {people
                  .filter((p) => p.kind === kind)
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
                        <small>{person.onScene ? '本幕在场' : '场外人物'}</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                {!people.some((p) => p.kind === kind) && (
                  <Empty>暂无符合条件的人物</Empty>
                )}
              </section>
            ))}
          </div>
          <section className="card">
            {selected ? (
              <>
                <span className="tag">
                  {selected.profile ? '人物档案与创角设定 · 分别记录' : '人物档案'}
                </span>
                <h3>{selected.name}</h3>
                <p className="muted">{selected.isContact ? '联系人 · 永久保留档案' : selected.contactReviewPending ? '旧档联系人身份待确认 · 暂缓清理' : '人物档案 · 尚未登记为联系人'}</p>
                <dl>
                  <Detail label="身份">{selected.identity || selected.authoredProfile?.identity || '未记录'}</Detail>
                  <Detail label="与主角关系">
                    {selected.relationshipText || selected.authoredProfile?.relationshipText || '未记录'}
                  </Detail>
                  <Detail label="关系倾向">
                    {selected.affinity === null ? '尚未确认' : selected.affinity}
                  </Detail>
                  <Detail label="当前位置">
                    {view.locations.find((p) => p.id === selected.locationId)?.name || selected.locationId || '未记录'}
                  </Detail>
                  <Detail label="年龄">{selected.age ?? '未记录'}</Detail>
                  <Detail label="外貌">{selected.appearance || '未记录'}</Detail>
                  <Detail label="性格">{selected.temperament || '未记录'}</Detail>
                  <Detail label="能力">{selected.skills.join('、') || '未记录'}</Detail>
                  <Detail label="身体状态">{selected.healthText || '未记录'}</Detail>
                  <Detail label="个人背景">{selected.background || '未记录'}</Detail>
                  {selected.kind === 'special' && <>
                    <Detail label="详细经历">{selected.detailedBackground || '未记录'}</Detail>
                    <Detail label="个人目标">{selected.activeGoals.join('；') || '无'}</Detail>
                    <Detail label="习惯">{selected.habits.join('；') || '未记录'}</Detail>
                  </>}
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
                {selected.authoredProfile && <WorldRecord title="创角原始设定（不替代当前状态）" value={selected.authoredProfile} />}
                <WorldRecord title="完整人物资料" value={{ ...selected, memories: undefined, longTermMemories: undefined, knownInformation: undefined, summaries: undefined }} />
                <RecordList key={`${selected.id}:knowledge`} label="人物已知信息" entries={selected.knownInformation} render={info => <article className="entry"><p>{info.text}</p><p>来源：{info.source}</p><time>{dateTime(info.learnedAt)}</time></article>} />
                <RecordList key={selected.id} label="人物记忆与总结" entries={view.memories.filter(memory => memory.ownerNpcId === selected.id)} render={memory => <article className="card entry"><MemoryRecord memory={memory} view={view} /></article>} />
              </>
            ) : (
              <Empty>选择人物，查看完整资料与独立认知。</Empty>
            )}
          </section>
        </div>
        <details><summary>退场人物保留资料</summary><RecordList label="退场人物" entries={view.retiredNpcs} render={person => <article className="card entry"><h3>{person.name}</h3><WorldRecord value={person} /></article>} /></details>
      </>
    );
  }
  if (name === '势力组织')
    return (
      <>
        <p className="muted">玩家可查看全部组织资料；组织掌握的信息与角色认知仍分别维护。</p>
        <div className="two-grid">
          {Object.entries(orgLabels).map(([kind, label]) => (
            <section className="card" key={kind}>
              <h3>{label}</h3>
              {view.organizations
                .filter((o) => o.kind === kind)
                .map((org) => (
                  <article className="entry" key={org.id}>
                    <h4>{org.name}</h4>
                    <p>{org.description}</p><p>与主角关系：{org.protagonistRelation}</p><WorldRecord value={org} />
                  </article>
                ))}
              {!view.organizations.some((o) => o.kind === kind) && <Empty>尚无已记录组织</Empty>}
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
              <span>⌖ {place.name}</span><WorldRecord title="地点资料" value={place} />
              {branch(place.id)}
            </li>
          ))}
      </ul>
    );
    return (
      <>
        <p className="muted">全部已记录地点 · 地理层级随世界发展扩展。</p>
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
                <WorldRecord title="物品完整资料与持有人" value={item} />
                <dl>
                  <Detail label="数量">{item.quantity}</Detail>
                  <Detail label="位置">
                    {view.locations.find((p) => p.id === item.locationId)?.name || '未记录'}
                  </Detail>
                  <Detail label="状态">{item.conditionText || '未记录'}</Detail>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <Empty>暂无已登记的重要物品。开局确认后，拥有的物品会显示在这里。</Empty>
        )}
        <WorldRecord title="全部正式经济与资产记录（金额单位：人民币分）" value={view.economy} />
      </>
    );
  if (name === '世界事件')
    return <>
      <p className="muted">全部正式事件与排程可供玩家观察。计划不等于完成；人物陈述不等于客观事实，查看不会改变角色认知。</p>
      <RecordList label="世界事件" entries={view.events} render={event => <article className="card entry">
        <span className="tag">{eventStatuses[event.status]}</span><h3>{event.title}</h3>
        <p>开始：{dateTime(event.startAt)}</p><p>预计结束：{event.estimatedEndAt ? dateTime(event.estimatedEndAt) : '旧记录未规划'}</p>
        <p>背景：{event.backgroundText || '未记录'}</p><p>目标：{event.goalText || '未记录'}</p>
        {event.resolutionText && <p>结果叙述（含人物陈述）：{event.resolutionText}</p>}
        <WorldRecord title="全部事件字段与引用" value={event} />
      </article>} />
      <details><summary>任务进展</summary><RecordList label="世界任务" entries={view.tasks} render={task => <article className="card entry"><h3>{task.goal}</h3><p>{task.status}</p><WorldRecord value={task} /></article>} /></details>
      <details><summary>已清理事件的保留记录</summary><RecordList label="事件保留记录" entries={view.retiredEvents} render={event => <article className="card entry"><h3>{event.detail?.title ?? event.id}</h3><WorldRecord value={event} /></article>} /></details>
    </>;
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
          <Empty>重大事件实际结束并具有可信成果后进入历史；无需主角先获知。</Empty>
        )}
      </>
    );
  return <MemoryPanel view={view} />;
}
