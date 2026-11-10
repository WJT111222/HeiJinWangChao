import { useEffect, useRef, useState } from 'react';
import { Detail, Empty } from '../Dialog';
import { dateTime } from './playerView';
import type { ObservedMemory, PlayerView } from './playerView';
import { RecordList } from './WorldRecord';

export type NpcManagement = { change: (id: string) => void; pendingId?: string; message: string };
type Person = PlayerView['npc'][number];
const nature = { observed: '亲历 / 观察', reported: '转述（未核实）', suspected: '推测（未确认）', unknown: '认知来源未分类' };
const gender = { female: '女', male: '男', unknown: '未记录' };
const phone = { known: '已掌握联系途径', unknown: '尚未掌握', invalid: '已失效' };
const placeRole = { home: '住处', work: '工作地点', frequent: '经常活动' };

function Star({ person, management }: { person: Person; management?: NpcManagement }) {
  return <button className={`npc-star ${person.kind === 'special' ? 'is-special' : ''}`} type="button"
    aria-label={`${person.kind === 'special' ? '取消特殊身份' : '设为特殊人物'}：${person.name}`}
    aria-pressed={person.kind === 'special'} disabled={!management || Boolean(management.pendingId)}
    onClick={() => management?.change(person.id)}>
    <span aria-hidden="true">{person.kind === 'special' ? '★' : '☆'}</span>
  </button>;
}

/** Human-readable source links, not raw ID/provenance objects. Does not rewrite a record. */
export function PersonMemory({ memory, view, person }: { memory: ObservedMemory; view: PlayerView; person: Person }) {
  const turns = memory.sourceTurnIds.map(id => view.journal.find(t => t.turnId === id)).filter(t => t !== undefined);
  return <article className="entry npc-memory">
    <span className="tag">{memory.layer}</span>{' '}<span>{nature[memory.knowledgeKind ?? 'unknown']}</span>
    <p className="muted">{memory.createdAtGameTime ? dateTime(memory.createdAtGameTime) : '历史回合时间未记录'} · {memory.visibility === 'internal' ? '内部世界记录 · 不代表任何角色已知' : memory.visibility === 'npc_private' ? '人物私有记录 · 不代表主角已知' : '主角已知记录'}</p>
    <p className="prose">{memory.text}</p>
    {memory.knowledgeSource && <p className="prose">知识来源：{memory.knowledgeSource}</p>}
    <details><summary>来源与认知</summary>
      <p>{turns.length ? turns.map(t => `第 ${t.turnNumber} 回合`).join('、') : '来源回合未记录或原文暂不可用'}</p>
      {memory.affectedEntityRefs.length > 0 && <p>相关人物／组织：{memory.affectedEntityRefs.map(ref => ref.kind === 'protagonist' ? view.protagonist.name : ref.kind === 'npc' ? view.npc.find(n => n.id === ref.id)?.name ?? view.retiredNpcs.find(n => n.id === ref.id)?.name ?? '历史人物' : view.organizations.find(o => o.id === ref.id)?.name ?? '历史组织').join('、')}</p>}
      {memory.npcProvenance && <p>总结依据：{memory.npcProvenance.sourceMemoryIds.map(id => {
        const index = person.memories.findIndex(m => m.id === id);
        return index < 0 ? '原始来源暂不可用' : `第 ${index + 1} 条人物原始记忆`;
      }).join('、')}</p>}
    </details>
  </article>;
}

export function PrivateProfile({ person }: { person: Person }) {
  if (person.kind !== 'special' || person.gender !== 'female' || person.age !== undefined && person.age < 18) return null;
  const profile = person.privateProfile;
  return <section className="npc-section" aria-label="香闺秘档"><h4>香闺秘档</h4>
    {profile ? <dl>
      <Detail label="身材描述">{profile.bodyDescription || '未记录'}</Detail>
      <Detail label="胸部描述">{profile.chestDescription || '未记录'}</Detail>
      <Detail label="小穴描述">{profile.pussyDescription || '未记录'}</Detail>
      <Detail label="是否处女">{profile.isVirgin === true ? '是' : profile.isVirgin === false ? '否' : '未记录'}</Detail>
      <Detail label="初次经历对象">{profile.firstExperienceTarget || '未记录'}</Detail>
      <Detail label="初次经历时间">{profile.firstExperienceTime || '未记录'}</Detail>
      <Detail label="初次性经历">{profile.firstExperienceText || '尚未记录初次经历'}</Detail>
    </dl> : <Empty>私密档案尚未建立</Empty>}
  </section>;
}

export function NpcPanel({ view, management }: { view: PlayerView; management?: NpcManagement }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [personId, setPersonId] = useState<string>(), [page, setPage] = useState(0);
  const directory = useRef<HTMLDivElement>(null), detail = useRef<HTMLElement>(null);
  const directoryScroll = useRef(0), backButton = useRef<HTMLButtonElement>(null), detailTitle = useRef<HTMLHeadingElement>(null);
  const selected = view.npc.find(p => p.id === personId);
  const linkedTasks = selected?.kind === 'special' ? view.tasks.filter(t => t.actorRef.kind === 'npc' && t.actorRef.id === selected.id || selected.offscreenTaskIds.includes(t.id)) : [];
  const needle = query.trim().toLocaleLowerCase();
  const matches = view.npc.filter(p => (filter === 'all' || p.kind === filter) &&
    [p.name, ...p.aliases, p.identity].some(text => text?.toLocaleLowerCase().includes(needle)));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 20) - 1));
  useEffect(() => {
    if (personId && detail.current) {
      detail.current.scrollTop = 0;
      const target = backButton.current?.getClientRects().length ? backButton.current : detailTitle.current;
      target?.focus({ preventScroll: true });
    }
    else if (directory.current) directory.current.scrollTop = directoryScroll.current;
  }, [personId]);
  function select(id: string) { if (directory.current?.getClientRects().length) directoryScroll.current = directory.current.scrollTop; setPersonId(id); }
  const location = (id?: string) => view.locations.find(p => p.id === id)?.name ?? '未记录';
  return <div className="npc-panel" data-detail={Boolean(selected)}>
    {management?.message && <p className="npc-feedback" role="status">{management.message}</p>}
    {management?.pendingId && <p role="status">正在保存人物重要性…</p>}
    <div className="npc-layout">
      <div className="npc-directory" ref={directory}>
        <div className="npc-directory-tools">
          <h3>人物名录 <small>{view.npc.length}</small></h3>
          <label className="search">搜索人物<input value={query} maxLength={4000} placeholder="姓名、别名、身份或职业"
            onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
          <label>人物筛选<select aria-label="人物筛选" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
            <option value="all">全部人物</option><option value="special">特殊人物</option><option value="ordinary">普通人物</option>
          </select></label>
        </div>
        <ul className="npc-people" aria-label="人物名录">{matches.slice(currentPage * 20, (currentPage + 1) * 20).map(person => <li key={person.id} className="npc-directory-row">
          <button className="person-row" aria-label={`查看人物：${person.name}`} aria-pressed={person.id === personId} onClick={() => select(person.id)}>
            <span className="avatar" aria-hidden="true">{Array.from(person.name)[0]}</span>
            <span><strong>{person.name}</strong><small>{person.identity || '身份未记录'}</small><small>{person.relationshipText}</small>
              <small>{person.onScene ? '本幕在场' : '场外人物'}{person.lastInteractionAt ? ` · ${dateTime(person.lastInteractionAt)}` : ''}</small></span>
          </button><Star person={person} management={management} />
        </li>)}</ul>
        {!matches.length && <Empty>{view.npc.length ? '暂无符合条件的人物' : '尚无正式人物档案'}</Empty>}
        {matches.length > 20 && <div className="memory-pagination"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页人物</button><span>第 {currentPage + 1} 页</span><button disabled={(currentPage + 1) * 20 >= matches.length} onClick={() => setPage(currentPage + 1)}>下一页人物</button></div>}
        {view.retiredNpcs.length > 0 && <details><summary>历史身份记录</summary>{view.retiredNpcs.map(p => <p key={p.id}>{p.name} · {dateTime(p.retiredAt)}</p>)}</details>}
      </div>
      <section className="npc-detail" ref={detail} aria-label="人物详情">
        {selected ? <div key={selected.id}>
          <header className="npc-detail-heading">
            <button className="npc-back" ref={backButton} onClick={() => setPersonId(undefined)}>← 返回人物名录</button>
            <div className="npc-detail-title"><div><span className="tag">{selected.kind === 'special' ? '特殊人物' : '普通人物'}</span><h3 ref={detailTitle} tabIndex={-1}>{selected.name}</h3></div><Star person={selected} management={management} /></div>
          </header>
          <section className="npc-section"><h4>人物档案</h4><dl>
            <Detail label="别名">{selected.aliases.join('、') || '未记录'}</Detail>
            <Detail label="年龄">{selected.age ?? '未记录'}</Detail><Detail label="性别">{gender[selected.gender ?? 'unknown']}</Detail>
            <Detail label="身份">{selected.identity || '未记录'}</Detail>
            <Detail label="与主角关系">{selected.relationshipText}</Detail><Detail label="关系倾向">{selected.affinity === null ? '尚未确认' : selected.affinity}</Detail>
            <Detail label="场景状态">{selected.onScene ? '本幕在场' : '场外人物'}</Detail><Detail label="当前位置">{location(selected.locationId)}</Detail>
            <Detail label="最近互动">{selected.lastInteractionAt ? dateTime(selected.lastInteractionAt) : '未记录'}</Detail>
            <Detail label="外貌">{selected.appearance || '未记录'}</Detail><Detail label="性格">{selected.temperament || '未记录'}</Detail>
            <Detail label="能力">{selected.skills.join('、') || '未记录'}</Detail><Detail label="身体状态">{selected.healthText || '未记录'}</Detail>
            <Detail label="个人背景">{selected.background || '未记录'}</Detail>
          </dl></section>
          <section className="npc-section"><h4>联系与常驻地点</h4>
            <p>电话：{phone[selected.phoneContact?.status ?? 'unknown']}</p>{selected.phoneContact?.note && <p className="prose">{selected.phoneContact.note}</p>}
            {selected.usualLocations?.length ? <ul>{selected.usualLocations.map((place, i) => <li key={i}>{placeRole[place.role]}：{location(place.locationId)} <span className="tag">{place.knownToProtagonist ? '主角已知' : '世界记录／主角未知'}</span></li>)}</ul> : <Empty>常驻地点未记录</Empty>}
          </section>
          {selected.kind === 'special' && <section className="npc-section"><h4>特殊人物资料</h4>
            {selected.profilePending && <p className="npc-pending" role="status">特殊人物资料待完善，将在后续正常剧情的 Variables 阶段尝试补充。</p>}
            <dl><Detail label="详细经历">{selected.detailedBackground || '未记录'}</Detail><Detail label="个人目标">{selected.activeGoals.join('；') || '未记录'}</Detail><Detail label="习惯">{selected.habits.join('；') || '未记录'}</Detail></dl>
            <h4>人物关系网</h4>
            {selected.relationshipNetwork?.length ? selected.relationshipNetwork.map((relation, i) => {
              const target = relation.npcId ? view.npc.find(n => n.id === relation.npcId) : undefined;
              const name = target?.name ?? relation.name;
              return <article className="entry" key={i}>
                {target ? <button className="npc-relation-link" onClick={() => select(target.id)}>{name}</button> : <strong>{name}</strong>}
                <p>{relation.relationship} · {selected.name}对{name}的好感：{relation.affinity ?? '未知'}</p><p className="prose">{relation.description || '未记录'}</p>
              </article>;
            }) : <Empty>尚无已记录关系</Empty>}
            <h4>关联任务</h4>{linkedTasks.length ? <ul>{linkedTasks.map(task => <li key={task.id}>{task.goal}</li>)}</ul> : <Empty>暂无专属任务</Empty>}
          </section>}
          <PrivateProfile person={selected} />
          {selected.profile && <details className="npc-section"><summary>创角原始设定（不替代当前状态）</summary><dl>
            <Detail label="原始姓名">{selected.authoredProfile?.name || '未记录'}</Detail><Detail label="原始身份">{selected.authoredProfile?.identity || '未记录'}</Detail>
            <Detail label="原始关系">{selected.authoredProfile?.relationshipText || '未记录'}</Detail><Detail label="原始年龄">{selected.profile.age ?? '未记录'}</Detail>
            <Detail label="外貌">{selected.profile.appearance}</Detail><Detail label="性格">{selected.profile.temperament}</Detail><Detail label="能力">{selected.profile.skills.join('、')}</Detail><Detail label="个人经历">{selected.profile.background}</Detail>
          </dl></details>}
          <RecordList key={`${selected.id}:knowledge`} label="人物已知信息" entries={selected.knownInformation} text={info => `${info.text} ${info.source}`} render={info => <article className="entry"><p className="prose">{info.text}</p><p className="prose">来源：{info.source}</p><time>{dateTime(info.learnedAt)}</time></article>} />
          <RecordList key={`${selected.id}:memory`} label="人物记忆与总结" entries={view.memories.filter(m => m.ownerNpcId === selected.id)} text={m => `${m.text} ${m.knowledgeSource ?? ''}`} render={memory => <PersonMemory memory={memory} view={view} person={selected} />} />
        </div> : <Empty>选择人物，查看完整资料与独立认知。</Empty>}
      </section>
    </div>
  </div>;
}
