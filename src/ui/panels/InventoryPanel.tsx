import { useEffect, useRef, useState } from 'react';
import { Dialog, Detail, Empty } from '../Dialog';
import { categoryLabels, money } from './playerView';
import type { PlayerView } from './playerView';
import { inventoryGroups, protagonistInventory, itemAttributes, itemDescription, itemCategoryGroup } from './inventory';
import type { InventoryFilter, ItemGroup } from './inventory';

function ItemIcon({ group }: { group: ItemGroup | 'all' }) {
  const paths = {
    all: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    clothing: 'm8 3-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c0 4-8 4-8 0Z',
    devices: 'M7 2h10v20H7z M10 5h4 M11 19h2',
    documents: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8',
    tools: 'M14 3a6 6 0 0 0-5 8l-6 6 4 4 6-6a6 6 0 0 0 8-6l-4 3-4-4 3-4Z',
    supplies: 'm3 7 9-4 9 4-9 4Z M3 7v12l9 3 9-3V7 M12 11v11',
  };
  return <svg aria-hidden="true" className="inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d={paths[group]} /></svg>;
}

export function InventoryPanel({ view, desktop = false, initialId, onSelect, onOpenProfile }: {
  view: PlayerView; desktop?: boolean; initialId?: string; onSelect?: (id: string) => void; onOpenProfile?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<InventoryFilter>('all');
  // Defer a phone deep link until the outer native dialog has opened in this commit.
  const [selectedId, setSelectedId] = useState<string | undefined>(desktop ? initialId : undefined);
  const [query,setQuery] = useState(''), [page,setPage] = useState(0);
  const detailPane = useRef<HTMLElement>(null);
  const { items, equipped, counts } = protagonistInventory(view.items, view.protagonist);
  const selected = items.find(item => item.id === selectedId);
  const lastSelected = useRef<string | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const listScroll = useRef(0);
  // React flushes the enclosing dialog's passive effects before this follow-up render,
  // so the inner dialog enters the native top layer after its parent. No timer is needed.
  useEffect(() => { if (initialId) setSelectedId(initialId); },[desktop,initialId]);
  useEffect(() => {
    if (desktop) { if(selected) { if(detailPane.current) detailPane.current.scrollTop=0;detailTitle.current?.focus({preventScroll:true}); } return; }
    const target = selected ? detailTitle.current : buttons.current.get(lastSelected.current ?? '');
    const body = target?.closest<HTMLElement>('.modal-body');
    if (body && !selected) body.scrollTop = listScroll.current;
    target?.focus({ preventScroll: true });
    if (selected) lastSelected.current = selected.id;
  }, [selected, desktop]);
  const attributes = selected ? itemAttributes(selected) : [];
  const detail = selected ? <section className={desktop ? 'inventory-detail inv-detail' : 'inventory-detail'} ref={detailPane} aria-label="物品详情">
      <button className="inventory-back" onClick={() => setSelectedId(undefined)}>← 返回背包</button>
      <div className="inventory-detail-heading">
        {desktop ? <div className="inv-frame"><ItemIcon group={itemCategoryGroup[selected.category]} /></div> : <ItemIcon group={itemCategoryGroup[selected.category]} />}
        <div><span className="tag">{categoryLabels[selected.category]}</span>
          <h3 ref={detailTitle} tabIndex={-1}>{selected.name}</h3>
          <div className="inventory-badges">{equipped.has(selected.id) && <span className={desktop ? 'b-eq' : undefined}>已装备</span>}{selected.questItem && <span className={desktop ? 'b-quest' : undefined}>任务物品</span>}</div>
        </div>
      </div>
      <p className="inventory-description">{itemDescription(selected)}</p>
      <dl className={desktop ? 'dl' : undefined}>
        <Detail label="数量">{selected.quantity}</Detail>
        <Detail label="单件参考价值">{selected.referenceValue == null ? '待估价' : money(selected.referenceValue)}</Detail>
        <Detail label="当前状态">{selected.conditionText || '未记录'}</Detail>
        {attributes.map(attribute => <Detail key={attribute.key} label={attribute.label}>{attribute.value}</Detail>)}
      </dl>
      {desktop && <details className="inventory-provenance"><summary>来源与归属</summary><dl className="dl">
        <Detail label="记录 ID">{selected.id}</Detail>
        <Detail label="持有人">{onOpenProfile ? <button className="link-btn" onClick={()=>onOpenProfile(selected.ownerRef!.id)}>{view.protagonist.name} · 主角档案</button> : view.protagonist.name}</Detail>
        {selected.locationId && <Detail label="位置">{view.locations.find(p=>p.id===selected.locationId)?.name || '地点未确认'} · {selected.locationId}</Detail>}
        {selected.createdByTurnId && <Detail label="来源回合">{view.journal.find(t=>t.turnId===selected.createdByTurnId)?.turnNumber !== undefined ? `第 ${view.journal.find(t=>t.turnId===selected.createdByTurnId)!.turnNumber} 回合 · ` : ''}{selected.createdByTurnId}</Detail>}
      </dl></details>}
    </section> : desktop ? <section className="inventory-detail inv-detail inv-none" aria-label="物品详情"><div><ItemIcon group="all" /><p>选择物品，查看描述与属性</p></div></section> : null;
  const needle=query.trim().toLocaleLowerCase();
  const visible = items.filter(item => (filter === 'all' || itemCategoryGroup[item.category] === filter) && (!desktop || [item.name,itemDescription(item),item.conditionText].some(text=>text.toLocaleLowerCase().includes(needle))));
  const last=Math.max(0,Math.ceil(visible.length/20)-1),current=Math.min(page,last);
  const shown=desktop ? visible.slice(current*20,(current+1)*20) : visible;
  return <div className={desktop ? 'inventory-layout inv' : 'inventory-layout'}>
    <nav className={desktop ? 'inventory-filters inv-rail' : 'inventory-filters'} aria-label="物品分类">
      {inventoryGroups.map(group => <button key={group.id} aria-label={`${group.label}，${counts[group.id]}种物品`} aria-pressed={filter === group.id} onClick={() => { setFilter(group.id);if(desktop){setPage(0);setSelectedId(undefined);} }}>
        <ItemIcon group={group.id} /><span>{group.label}</span><span className="inventory-count">{counts[group.id]}</span>
      </button>)}
    </nav>
    <section className={desktop ? 'inventory-results inv-mid' : 'inventory-results'} aria-label="主角背包">
      {desktop && <label className="f-label inventory-search">搜索物品<input className="f-input search" value={query} maxLength={4000} placeholder="名称、描述或状态" onChange={e=>{setQuery(e.target.value);setPage(0);setSelectedId(undefined);}} /></label>}
      <div className="inventory-summary" role="status">{inventoryGroups.find(group => group.id === filter)?.label}<span>{visible.length} 种物品</span></div>
      {visible.length ? <ul className="inventory-grid">
        {shown.map(item => <li key={item.id}>
          <button className={equipped.has(item.id) ? 'inventory-tile is-eq' : 'inventory-tile'} data-item-id={item.id} aria-pressed={selectedId === item.id} onClick={event => {
            listScroll.current = event.currentTarget.closest('.modal-body')?.scrollTop ?? 0;
            setSelectedId(item.id);onSelect?.(item.id);
          }}
            ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}>
            <span className="cat">{categoryLabels[item.category]}</span><ItemIcon group={itemCategoryGroup[item.category]} />
            <strong>{item.name}</strong>{desktop && <span className="inventory-condition">{item.conditionText || '未记录'}</span>}<span className="inventory-quantity">×{item.quantity}</span>
            <span className="inventory-badges">{equipped.has(item.id) && <span className={desktop ? 'b-eq' : undefined}>已装备</span>}{item.questItem && <span className={desktop ? 'b-quest' : undefined}>任务</span>}</span>
          </button>
        </li>)}
      </ul> : <Empty>{desktop && needle ? '暂无符合条件的物品。' : filter === 'all' ? '背包里暂时没有物品。' : '此分类暂无物品。'}</Empty>}
      {desktop && last>0 && <nav className="memory-pagination" aria-label="物品分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页物品</button><span>{current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页物品</button></nav>}
    </section>
    {desktop ? detail : selected&&<Dialog title={selected.name} seal="物" eyebrow="ITEM · 物证" mobileVariant="sheet" className="mobile-archive mobile-archive-sub" onClose={()=>setSelectedId(undefined)} returnFocus={()=>buttons.current.get(selected.id)??null}>{detail}</Dialog>}
  </div>;
}
