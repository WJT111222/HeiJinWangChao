import { WorldEventsPanel } from './WorldEventsPanel';
import type { ReactNode } from 'react';
import { Empty } from '../Dialog';
import { orgLabels } from './playerView';
import type { PlayerView } from './playerView';
import { InventoryPanel } from './InventoryPanel';
import { HistoryPanel } from './HistoryPanel';
import { MemoryPanel } from './MemoryPanel';
import { WorldRecord } from './WorldRecord';
import { NpcPanel } from './NpcPanel';
import type { NpcManagement } from './NpcPanel';

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
export function Panels({ name, view, onOpenHistory, npcManagement }: { name: PanelName; view: PlayerView; onOpenHistory?:()=>void; npcManagement?: NpcManagement }) {
  if (name === 'NPC') return <NpcPanel view={view} management={npcManagement} />;
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
  if (name === '物品栏') return <InventoryPanel view={view} />;
  if (name === '世界事件') return <WorldEventsPanel view={view} onOpenHistory={onOpenHistory}/>;
  if (name === '历史时间轴') return <HistoryPanel view={view} />;
  return <MemoryPanel view={view} />;
}
