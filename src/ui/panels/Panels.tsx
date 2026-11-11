import { WorldEventsPanel } from './WorldEventsPanel';
import type { ReactNode } from 'react';
import { OrganizationPanel } from './OrganizationPanel';
import type { ArchiveLinks } from './OrganizationPanel';
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
export function Panels({ name, view, onOpenHistory, npcManagement, initialId, links }: { name: PanelName; view: PlayerView; onOpenHistory?:()=>void; npcManagement?: NpcManagement; initialId?: string; links?: ArchiveLinks }) {
  if (name === 'NPC') return <NpcPanel view={view} management={npcManagement} initialId={initialId} onOpenOrganization={links?.organization} />;
  if (name === '势力组织') return <OrganizationPanel view={view} initialId={initialId} links={links}/>;
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
  if (name === '世界事件') return <WorldEventsPanel view={view} onOpenHistory={onOpenHistory} initialId={initialId}/>;
  if (name === '历史时间轴') return <HistoryPanel view={view} />;
  return <MemoryPanel view={view} />;
}
