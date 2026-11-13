import { WorldEventsPanel } from './WorldEventsPanel';
import { MapPanel } from './MapPanel';
import { OrganizationPanel } from './OrganizationPanel';
import type { ArchiveLinks } from './OrganizationPanel';
import type { PlayerView } from './playerView';
import { InventoryPanel } from './InventoryPanel';
import { HistoryPanel } from './HistoryPanel';
import { MemoryPanel } from './MemoryPanel';
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
  if (name === '地图') return <MapPanel view={view} mobile initialId={initialId} onNpc={id=>links?.npc(id)} onEvent={id=>links?.event(id)} />;
  if (name === '物品栏') return <InventoryPanel view={view} initialId={initialId} />;
  if (name === '世界事件') return <WorldEventsPanel view={view} links={links} onOpenHistory={onOpenHistory} initialId={initialId}/>;
  if (name === '历史时间轴') return <HistoryPanel view={view} />;
  return <MemoryPanel view={view} />;
}
