import { useEffect, useRef, useState } from 'react';
import { Detail, Empty } from '../Dialog';
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

export function InventoryPanel({ view }: { view: PlayerView }) {
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const { items, equipped, counts } = protagonistInventory(view.items, view.protagonist);
  const selected = items.find(item => item.id === selectedId);
  const lastSelected = useRef<string | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const detailTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selected) { detailTitle.current?.focus(); lastSelected.current = selected.id; }
    else if (lastSelected.current) buttons.current.get(lastSelected.current)?.focus();
  }, [selected]);
  if (selected) {
    const attributes = itemAttributes(selected);
    return <section className="inventory-detail" aria-label="物品详情">
      <button className="inventory-back" onClick={() => setSelectedId(undefined)}>← 返回背包</button>
      <div className="inventory-detail-heading">
        <ItemIcon group={itemCategoryGroup[selected.category]} />
        <div><span className="tag">{categoryLabels[selected.category]}</span>
          <h3 ref={detailTitle} tabIndex={-1}>{selected.name}</h3>
          <div className="inventory-badges">{equipped.has(selected.id) && <span>已装备</span>}{selected.questItem && <span>任务物品</span>}</div>
        </div>
      </div>
      <p className="inventory-description">{itemDescription(selected)}</p>
      <dl>
        <Detail label="数量">{selected.quantity}</Detail>
        <Detail label="单件参考价值">{selected.referenceValue == null ? '待估价' : money(selected.referenceValue)}</Detail>
        <Detail label="当前状态">{selected.conditionText || '未记录'}</Detail>
        {attributes.map(attribute => <Detail key={attribute.key} label={attribute.label}>{attribute.value}</Detail>)}
      </dl>
    </section>;
  }
  const visible = items.filter(item => filter === 'all' || itemCategoryGroup[item.category] === filter);
  return <div className="inventory-layout">
    <nav className="inventory-filters" aria-label="物品分类">
      {inventoryGroups.map(group => <button key={group.id} aria-label={`${group.label}，${counts[group.id]}种物品`} aria-pressed={filter === group.id} onClick={() => setFilter(group.id)}>
        <ItemIcon group={group.id} /><span>{group.label}</span><span className="inventory-count">{counts[group.id]}</span>
      </button>)}
    </nav>
    <section className="inventory-results" aria-label="主角背包">
      <div className="inventory-summary" role="status">{inventoryGroups.find(group => group.id === filter)?.label}<span>{visible.length} 种物品</span></div>
      {visible.length ? <ul className="inventory-grid">
        {visible.map(item => <li key={item.id}>
          <button className="inventory-tile" onClick={() => setSelectedId(item.id)}
            ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}>
            <ItemIcon group={itemCategoryGroup[item.category]} />
            <strong>{item.name}</strong><span className="inventory-quantity">×{item.quantity}</span>
            <span className="inventory-badges">{equipped.has(item.id) && <span>已装备</span>}{item.questItem && <span>任务</span>}</span>
          </button>
        </li>)}
      </ul> : <Empty>{filter === 'all' ? '背包里暂时没有物品。' : '此分类暂无物品。'}</Empty>}
    </section>
  </div>;
}
