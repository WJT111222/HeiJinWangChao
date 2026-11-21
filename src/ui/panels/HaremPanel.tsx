import { useRef, useState } from 'react';
import { currentStanding, activeMembers } from '../../domain/harem/schema';
import type { HaremMember } from '../../domain/harem/schema';
import { Dialog } from '../Dialog';
import { NpcPanel, type NpcManagement } from './NpcPanel';
import { dateTime, type PlayerView } from './playerView';
import './harem.css';

const pregnancyLabels = {
  unknown: '尚未确认',
  not_pregnant: '已确认未妊娠',
  suspected: '疑似',
  confirmed: '已确认妊娠',
  ended: '妊娠已结束',
};
const kinships = { biological: '亲生', adoptive: '收养', step: '继亲', other: '其他已确认亲子' };
const planLabels = {
  planned: '计划中',
  active: '进行中',
  blocked: '受阻',
  done: '已完成',
  cancelled: '已取消',
};
function visiblePlan(member: HaremMember) {
  const p = member.plan;
  return p && p.status !== 'done' && p.status !== 'cancelled' ? p : undefined;
}

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
  const changes = Object.values(h?.members ?? {})
    .flatMap((m) => m.changes.map((change, index) => ({ ...change, id: m.id, index })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.index - a.index)
    .slice(0, 5);
  const family = [
    ...Object.values(h?.members ?? {}).flatMap((m) =>
      m.pregnancy ? [{ id: m.id, at: m.pregnancy.at, text: pregnancyLabels[m.pregnancy.status] }] : [],
    ),
    ...children.map((c) => ({ id: c.childNpcId, at: c.at, text: kinships[c.kinship] + '子女已登记' })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5);
  function link(id: string) {
    return (
      <button
        className="household-person"
        data-person-id={id}
        onClick={(event) => {
          opener.current = event.currentTarget;
          setPerson(id);
        }}
      >
        {people.get(id)?.name ?? id}
      </button>
    );
  }
  const stats = [
    ['现役成员', members.length],
    ['当前正宫', members[0] ? people.get(members[0].id)?.name + ' · 100' : '暂无正宫'],
    ['和谐度', members.length ? (h?.overview?.harmony ?? '尚未确认') : '尚未确认'],
    ['历史退出', exited.length],
    ['已确认妊娠', members.filter((m) => m.pregnancy?.status === 'confirmed').length],
    ['已知主角子嗣', children.length],
    ['重要规划', members.filter(visiblePlan).length],
    ['合作关系', pairs.filter((p) => p.cooperation).length],
    ['矛盾关系', pairs.filter((p) => p.conflict).length],
  ];
  return (
    <div className="household">
      <section aria-label="后宫综合信息">
        <h3>后宫综合信息</h3>
        <dl className="household-stats">
          {stats.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="household-facts">
          <dt>地位分布</dt>
          <dd>
            {members.length
              ? members
                  .slice(1)
                  .map((m) => currentStanding(m))
                  .join('、') || '仅有正宫'
              : '暂无成员'}
          </dd>
          <dt>竞争态势</dt>
          <dd>{(members.length && h?.overview?.competition) || '尚未确认'}</dd>
          <dt>整体局势</dt>
          <dd>{(members.length && h?.overview?.summary) || '尚未确认'}</dd>
        </dl>
        {pairs.length > 0 && (
          <details>
            <summary>成员关系（{pairs.length} 组）</summary>
            <ul>
              {pairs.map((p) => (
                <li key={JSON.stringify([p.leftNpcId, p.rightNpcId])}>
                  {people.get(p.leftNpcId)?.name}与{people.get(p.rightNpcId)?.name} · {p.relationship}
                </li>
              ))}
            </ul>
          </details>
        )}
        {changes.length > 0 && (
          <details>
            <summary>
              最近 {changes.length} 笔地位变动 · {new Set(changes.map((c) => c.id)).size} 人
            </summary>
            <ul>
              {changes.map((c) => (
                <li key={c.id + ':' + c.index}>
                  {people.get(c.id)?.name} · {c.from ?? '加入'} → {c.to ?? '退出'} · {c.reason}（
                  {dateTime(c.at)}）
                </li>
              ))}
            </ul>
          </details>
        )}
        {family.length > 0 && (
          <details>
            <summary>近期家庭变化</summary>
            <ul>
              {family.map((f) => (
                <li key={f.id + f.text}>
                  {people.get(f.id)?.name} · {f.text}（{dateTime(f.at)}）
                </li>
              ))}
            </ul>
          </details>
        )}
        {exited.length > 0 && (
          <details>
            <summary>查看退出成员</summary>
            <ul>
              {exited.map((m) => (
                <li key={m.id}>
                  {link(m.id)} · {m.changes.at(-1)?.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section aria-label="现役成员">
        <h3>现役成员</h3>
        {!members.length && <p>暂无正式后宫成员</p>}
        <div className="household-grid">
          {members.map((m, i) => {
            const p = people.get(m.id)!,
              standing = currentStanding(m),
              plan = visiblePlan(m);
            const offspring = children.filter((c) => c.parentNpcId === m.id);
            return (
              <article className="household-card" key={m.id} data-member-id={m.id}>
                <header>
                  <h4>{link(m.id)}</h4>
                  <strong>
                    {standing === 100 ? '正宫' : '成员'} · {standing} 分
                  </strong>
                </header>
                <dl className="household-facts">
                  <dt>地位排名</dt>
                  <dd>第 {i + 1} 位</dd>
                  <dt>年龄</dt>
                  <dd>{p.age} 岁</dd>
                  <dt>职业／身份</dt>
                  <dd>{p.identity || '尚未确认'}</dd>
                  <dt>所在地</dt>
                  <dd>{locations.get(p.locationId ?? '') ?? '尚未确认'}</dd>
                  <dt>与主角关系</dt>
                  <dd>{p.relationshipText}</dd>
                  <dt>上次联络</dt>
                  <dd>{p.lastInteractionAt ? dateTime(p.lastInteractionAt) : '暂无联络记录'}</dd>
                  <dt>妊娠</dt>
                  <dd>{pregnancyLabels[m.pregnancy?.status ?? 'unknown']}</dd>
                  <dt>已知子嗣</dt>
                  <dd>
                    {offspring.length} 人{' '}
                    {offspring.map((c) => (
                      <span key={c.childNpcId}>
                        {link(c.childNpcId)}（{kinships[c.kinship]}）
                      </span>
                    ))}
                  </dd>
                  <dt>重要行动</dt>
                  <dd>
                    {plan ? plan.action + '（' + planLabels[plan.status] + '）' : '正常生活，暂无重大规划'}
                  </dd>
                  <dt>当前目的</dt>
                  <dd>{plan?.purpose ?? '暂无明确目标'}</dd>
                </dl>
              </article>
            );
          })}
        </div>
      </section>
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
          <NpcPanel
            view={view}
            initialId={person}
            management={management}
            onBack={() => setPerson(undefined)}
          />
        </Dialog>
      )}
    </div>
  );
}
