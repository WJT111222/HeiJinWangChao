import { useRef, useState } from 'react';
import { currentStanding, activeMembers } from '../../domain/harem/schema';
import type { HaremMember } from '../../domain/harem/schema';
import { Dialog } from '../Dialog';
import { NpcPanel, type NpcManagement } from './NpcPanel';
import { dateTime, type PlayerView } from './playerView';
import './harem.css';

const pregnancyLabels = {
  unknown: '尚未确认',
  not_pregnant: '未妊娠',
  suspected: '疑似妊娠',
  confirmed: '已确认妊娠',
  ended: '妊娠已结束',
};
const kinships = { biological: '亲生', adoptive: '收养', step: '继亲', other: '其他' };
const planLabels = { planned: '计划中', active: '进行中', blocked: '受阻', done: '已完成', cancelled: '已取消' };
function visiblePlan(member: HaremMember) {
  const p = member.plan;
  return p && p.status !== 'done' && p.status !== 'cancelled' ? p : undefined;
}
const rank = (index: number) => String(index + 1).padStart(2, '0');

function Meter({ value, label }: { value: number; label: string }) {
  return <div className="hh-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span style={{ width: `${value}%` }}/>
  </div>;
}

/** 后宫档案：只读展示正式家庭记录中玩家已知的部分；点名字打开人物档案。 */
export function HaremPanel({ view, management }: { view: PlayerView; management?: NpcManagement }) {
  const [person, setPerson] = useState<string>();
  const opener = useRef<HTMLButtonElement | null>(null);
  const h = view.harem;
  const people = new Map(view.npc.map((p) => [p.id, p]));
  const locations = new Map(view.locations.map((p) => [p.id, p.name]));
  const members = h ? activeMembers(h) : [];
  const ids = new Set(members.map((m) => m.id));
  const exited = Object.values(h?.members ?? {}).filter((m) => !ids.has(m.id));
  const children = h?.children ?? [];
  const pairs = (h?.pairs ?? []).filter((p) => ids.has(p.leftNpcId) && ids.has(p.rightNpcId));
  const name = (id: string) => people.get(id)?.name ?? id;
  const timeline = [
    ...Object.values(h?.members ?? {}).flatMap((m) => m.changes.map((change, index) => ({
      key: `${m.id}:${index}`, id: m.id, at: change.at, index,
      text: change.from === null ? `加入 · 地位 ${change.to}` : change.to === null ? '退出' : `地位 ${change.from} → ${change.to}`,
      reason: change.reason,
    }))),
    ...Object.values(h?.members ?? {}).flatMap((m) => m.pregnancy && m.pregnancy.status !== 'unknown'
      ? [{ key: `${m.id}:pregnancy`, id: m.id, at: m.pregnancy.at, index: 0, text: pregnancyLabels[m.pregnancy.status], reason: m.pregnancy.reason }] : []),
    ...children.map((c) => ({ key: `${c.childNpcId}:child`, id: c.parentNpcId, at: c.at, index: 0,
      text: `${kinships[c.kinship]}子女 ${name(c.childNpcId)} 登记`, reason: c.reason })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.index - a.index).slice(0, 8);

  function link(id: string, className = '') {
    return <button type="button" className={`household-person ${className}`.trim()} data-person-id={id}
      onClick={(event) => { opener.current = event.currentTarget; setPerson(id); }}>{name(id)}</button>;
  }
  const primary = members[0], primaryPerson = primary && people.get(primary.id);
  const harmony = members.length ? h?.overview?.harmony ?? null : null;
  const stats = [
    { label: '现役成员', value: `${members.length}`, note: exited.length ? `历史退出 ${exited.length} 人` : '暂无退出' },
    { label: '和谐度', value: harmony === null ? '尚未确认' : `${harmony}`, meter: harmony ?? undefined },
    { label: '妊娠', value: `${members.filter((m) => m.pregnancy?.status === 'confirmed').length}`, note: '已确认' },
    { label: '主角子嗣', value: `${children.length}`, note: '已知' },
  ];

  return (
    <div className="household" data-empty={members.length ? undefined : 'true'}>
      <section className="hh-hero" aria-label="后宫综合信息">
        <div className="hh-primary">
          <span className="hh-crown" aria-hidden="true">宫</span>
          {primary && primaryPerson ? <div className="hh-primary-body">
            <span className="hh-eyebrow">当前正宫</span>
            <h3>{link(primary.id, 'hh-primary-name')}</h3>
            <p className="hh-sub">{[primaryPerson.age !== undefined ? `${primaryPerson.age} 岁` : '', primaryPerson.identity].filter(Boolean).join(' · ') || '尚未确认'}</p>
            {primaryPerson.relationshipText && <p className="hh-quote">{primaryPerson.relationshipText}</p>}
          </div> : <div className="hh-primary-body">
            <span className="hh-eyebrow">当前正宫</span>
            <h3>暂无正宫</h3>
          </div>}
        </div>
        <dl className="hh-stats">
          {stats.map((s) => <div key={s.label} className="hh-stat">
            <dt>{s.label}</dt>
            <dd><span className="hh-stat-value" data-unknown={s.value === '尚未确认' || undefined}>{s.value}</span>
              {s.meter !== undefined ? <Meter value={s.meter} label={`和谐度 ${s.meter}`}/> : s.note && <small>{s.note}</small>}</dd>
          </div>)}
        </dl>
        {members.length > 0 && <dl className="hh-situation">
          <div><dt>竞争态势</dt><dd>{h?.overview?.competition || '尚未确认'}</dd></div>
          <div><dt>整体局势</dt><dd>{h?.overview?.summary || '尚未确认'}</dd></div>
        </dl>}
      </section>

      <section className="hh-section" aria-label="现役成员">
        <h3 className="hh-heading">现役成员<small>按地位排序</small></h3>
        {!members.length && <p className="hh-empty">暂无正式后宫成员</p>}
        <div className="household-grid">
          {members.map((m, i) => {
            const p = people.get(m.id)!, standing = currentStanding(m)!, plan = visiblePlan(m);
            const offspring = children.filter((c) => c.parentNpcId === m.id);
            const place = locations.get(p.locationId ?? '');
            return (
              <article className="household-card" key={m.id} data-member-id={m.id} data-primary={standing === 100 || undefined}>
                <header>
                  <span className="hh-rank" aria-label={`地位第 ${i + 1} 位`}>{rank(i)}</span>
                  <h4>{link(m.id)}</h4>
                  <span className="hh-pill" data-tone={standing === 100 ? 'gold' : undefined}>{standing === 100 ? '正宫' : '成员'} · {standing} 分</span>
                </header>
                <Meter value={standing} label={`地位 ${standing}`}/>
                <p className="hh-meta">{[p.age !== undefined ? `${p.age} 岁` : '', p.identity || '尚未确认', place].filter(Boolean).join(' · ')}</p>
                {p.relationshipText && <p className="hh-relation">{p.relationshipText}</p>}
                <div className="hh-tags">
                  {m.pregnancy && m.pregnancy.status !== 'unknown' && <span className="hh-pill" data-tone={m.pregnancy.status === 'confirmed' ? 'gold' : undefined}>{pregnancyLabels[m.pregnancy.status]}</span>}
                  {plan && <span className="hh-pill">{plan.action} · {planLabels[plan.status]}</span>}
                  {offspring.map((c) => <span key={c.childNpcId} className="hh-child">子女 {link(c.childNpcId)}<small>{kinships[c.kinship]}</small></span>)}
                </div>
                {plan?.purpose && <p className="hh-purpose">目的：{plan.purpose}</p>}
                <footer>上次联络 {p.lastInteractionAt ? dateTime(p.lastInteractionAt) : '暂无记录'}</footer>
              </article>
            );
          })}
        </div>
      </section>

      {(pairs.length > 0 || timeline.length > 0) && <div className="hh-lower">
        {pairs.length > 0 && <section className="hh-section hh-box" aria-label="成员关系">
          <h3 className="hh-heading">成员关系<small>{pairs.length} 组</small></h3>
          <ul className="hh-pairs">{pairs.map((p) => <li key={JSON.stringify([p.leftNpcId, p.rightNpcId])}>
            <span className="hh-pair-names">{link(p.leftNpcId)}<span aria-hidden="true">⟷</span><span className="hh-visually-hidden">与</span>{link(p.rightNpcId)}</span>
            <span className="hh-pair-text">{p.relationship}</span>
            <span className="hh-pair-tags">{p.cooperation && <span className="hh-pill" data-tone="teal">合作</span>}{p.conflict && <span className="hh-pill" data-tone="warn">矛盾</span>}</span>
          </li>)}</ul>
        </section>}
        {timeline.length > 0 && <section className="hh-section hh-box" aria-label="近期变动">
          <h3 className="hh-heading">近期变动</h3>
          <ol className="hh-timeline">{timeline.map((t) => <li key={t.key}>
            <span className="hh-when">{dateTime(t.at)}</span>
            <span><strong>{name(t.id)}</strong> {t.text}</span>
            <span className="hh-reason">{t.reason}</span>
          </li>)}</ol>
        </section>}
      </div>}

      {exited.length > 0 && <details className="hh-exited">
        <summary>已退出成员（{exited.length}）</summary>
        <ul>{exited.map((m) => <li key={m.id}>{link(m.id)}<span>{m.changes.at(-1)?.reason}</span></li>)}</ul>
      </details>}

      {person && (
        <Dialog
          title="NPC 人物档案"
          className="npc-dialog household-profile"
          mobileVariant="sheet"
          sheetFull
          seal="人"
          closeLabel="关闭人物档案并返回后宫"
          onClose={() => setPerson(undefined)}
          returnFocus={() => opener.current}
        >
          <NpcPanel view={view} initialId={person} management={management} onBack={() => setPerson(undefined)} />
        </Dialog>
      )}
    </div>
  );
}
