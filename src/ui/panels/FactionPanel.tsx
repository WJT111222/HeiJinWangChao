import { useId } from 'react';
import { Detail, Empty } from '../Dialog';
import type { ArchiveLinks } from './OrganizationPanel';
import { dateTime, type PlayerView } from './playerView';
import { eventStatusLabels } from './eventArchive';
import { factionView } from './factionView';
import './faction.css';

const stageLabels = { done: '已完成', now: '进行中', next: '已排定' } as const;
const kindLabels = { observed: '亲眼所见', reported: '听说' } as const;

function Person({ id, name, position, links }: { id: string; name: string; position: string; links?: ArchiveLinks }) {
  const label = <><span className="fc-avatar" aria-hidden="true">{Array.from(name)[0]}</span><span>{name}<small>{position}</small></span></>;
  return links ? <button type="button" className="fc-person" aria-label={`查看人物：${name}（${position}）`} onClick={() => links.npc(id)}>{label}</button>
    : <span className="fc-person">{label}</span>;
}

/** 「我的势力」：主角唯一主势力的只读视图。资料全部来自正式存档，不新增或推断数据。 */
export function FactionPanel({ view, links, desktop = false }: { view: PlayerView; links?: ArchiveLinks; desktop?: boolean }) {
  const uid = useId(), data = factionView(view);
  if (!data) return <div className="faction-panel" data-empty="true" data-desktop={desktop || undefined}>
    <div className="fc-empty">
      <span className="fc-empty-seal" aria-hidden="true">势</span>
      <h3>目前孤身一人</h3>
    </div>
  </div>;
  const { org, faction } = data;
  return <div className="faction-panel" data-desktop={desktop || undefined} data-kind={org.kind}>
    <header className="fc-head">
      <div className="fc-title">
        <h3>{links ? <button type="button" className="fc-link" onClick={() => links.organization(org.id)}>{org.name}</button> : org.name}</h3>
        <span className="fc-pill">{data.kindLabel}</span>
        <span className="fc-pill" data-tone="gold">我的身份：{faction.position}{data.department ? ` · ${data.department}` : ''}</span>
      </div>
      <p className="fc-lead">{faction.bondText}</p>
      <p className="fc-meta">{dateTime(faction.joinedAt)} 起以此为主势力</p>
    </header>

    <div className="fc-grid">
      <section className="fc-card" aria-labelledby={`${uid}-public`}>
        <h4 id={`${uid}-public`}>公开信息<small>任何人都能知道的</small></h4>
        {data.publicRows.length ? <dl className="fc-dl">{data.publicRows.map(row => <Detail key={row.label} label={row.label}>{row.value}</Detail>)}</dl>
          : <Empty>公开信息尚未记录</Empty>}
      </section>
      <section className="fc-card" aria-labelledby={`${uid}-relations`}>
        <h4 id={`${uid}-relations`}>对外关系</h4>
        {data.relations.length ? <ul className="fc-list">{data.relations.map(row => <li key={row.organizationId}>
          {links ? <button type="button" className="fc-link" onClick={() => links.organization(row.organizationId)}>{row.name}</button> : <strong>{row.name}</strong>}
          <span className="fc-pill">{row.relation}</span>{row.description && <span className="fc-note">{row.description}</span>}
        </li>)}</ul> : <Empty>暂无已记录的对外关系</Empty>}
      </section>
    </div>

    <section className="fc-card" aria-labelledby={`${uid}-departments`}>
      <h4 id={`${uid}-departments`}>部门<small>部门下列出认识的人</small></h4>
      {data.departments.length ? <div className="fc-departments">{data.departments.map(row => <article key={row.id} className="fc-dept" data-mine={row.mine || undefined}>
        <header><strong>{row.name}</strong>{row.mine && <span className="fc-pill" data-tone="gold">我在这里</span>}</header>
        <dl className="fc-dl">
          <Detail label="负责人">{[row.headPosition, row.headName].filter(Boolean).join(' ') || '还不知道是谁'}</Detail>
          {row.duty && <Detail label="职能">{row.duty}</Detail>}
          {row.scaleText && <Detail label="规模">{row.scaleText}</Detail>}
          {row.statusText && <Detail label="现状">{row.statusText}</Detail>}
        </dl>
        {(row.people.length > 0 || row.mine) && <div className="fc-people">
          {row.mine && <span className="fc-person" data-self="true"><span className="fc-avatar" aria-hidden="true">我</span><span><span className="fc-visually-hidden">我：</span>{faction.position}</span></span>}
          {row.people.map(person => <Person key={person.id} {...person} links={links}/>)}
        </div>}
      </article>)}</div> : <Empty>部门尚未记录</Empty>}
      {data.otherPeople.length > 0 && <div className="fc-people" aria-label="其他认识的成员">
        {data.otherPeople.map(person => <Person key={person.id} {...person} links={links}/>)}
      </div>}
    </section>

    <section className="fc-card" aria-labelledby={`${uid}-ongoing`}>
      <h4 id={`${uid}-ongoing`}>势力正在进行的事<small>承接世界事件中的主事件</small></h4>
      {data.ongoing.length ? <ul className="fc-events">{data.ongoing.map(event => <li key={event.id}>
        <div className="fc-event-head">
          {links ? <button type="button" className="fc-link" onClick={() => links.event(event.id)}>{event.title}</button> : <strong>{event.title}</strong>}
          <span className="fc-pill">{eventStatusLabels[event.status]}</span>
        </div>
        {event.stages.length > 0 && <ol className="fc-stages" aria-label={`${event.title}的阶段`}>{event.stages.map(stage =>
          <li key={stage.id} data-state={stage.state}><span className="fc-visually-hidden">{stageLabels[stage.state]}：</span>{stage.title}</li>)}</ol>}
        <p className="fc-note">{[event.departments.length ? `${event.departments.join('、')}参与` : '', event.startAt ? `${dateTime(event.startAt)} 开始` : '', event.relation ?? ''].filter(Boolean).join(' · ')}</p>
      </li>)}</ul> : <Empty>暂无进行中的大事</Empty>}
    </section>

    <div className="fc-grid">
      <section className="fc-card" aria-labelledby={`${uid}-holdings`}>
        <h4 id={`${uid}-holdings`}>知道的据点与产业</h4>
        {data.holdings.length ? <ul className="fc-list">{data.holdings.map(row => <li key={row.id}>
          <strong>{row.text}</strong>{row.statusText && <span className="fc-pill">{row.statusText}</span>}
          <span className="fc-note">{kindLabels[row.knowledgeKind]} · {row.source} · {dateTime(row.learnedAt)}</span>
        </li>)}</ul> : <Empty>还不知道这个势力的据点或产业</Empty>}
      </section>
      <section className="fc-card" aria-labelledby={`${uid}-intel`}>
        <h4 id={`${uid}-intel`}>知道的内情</h4>
        {data.intel.length ? <ul className="fc-list">{data.intel.map(row => <li key={row.id}>
          <span>{row.text}</span><span className="fc-pill">{kindLabels[row.knowledgeKind]}</span>
          <span className="fc-note">{row.source} · {dateTime(row.learnedAt)}</span>
        </li>)}</ul> : <Empty>还不知道什么内情</Empty>}
      </section>
    </div>

    <div className="fc-grid">
      <section className="fc-card" aria-labelledby={`${uid}-mine`}>
        <h4 id={`${uid}-mine`}>手上的事</h4>
        {data.mine.length ? <ul className="fc-list">{data.mine.map(event => <li key={event.id}>
          {links ? <button type="button" className="fc-link" onClick={() => links.event(event.id)}>{event.title}</button> : <span>{event.title}</span>}
          <span className="fc-pill">{eventStatusLabels[event.status]}</span>
        </li>)}</ul> : <Empty>暂无</Empty>}
      </section>
      <section className="fc-card" aria-labelledby={`${uid}-recent`}>
        <h4 id={`${uid}-recent`}>近期动态</h4>
        {data.recent.length ? <ul className="fc-list">{data.recent.map(event => <li key={event.id}>
          {event.at && <span className="fc-when">{dateTime(event.at)}</span>}
          {links ? <button type="button" className="fc-link" onClick={() => links.event(event.id)}>{event.title}</button> : <span>{event.title}</span>}
          {event.outcome && <span className="fc-note">{event.outcome}</span>}
        </li>)}</ul> : <Empty>暂无近期动态</Empty>}
      </section>
    </div>
  </div>;
}
