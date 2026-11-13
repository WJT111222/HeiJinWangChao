import type { ChangeGroup } from './turnChanges';
import { panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
/** Count actual destination rows, not group totals or unread state. */
export function turnChangeBadges(groups:readonly ChangeGroup[]):Partial<Record<PanelName,number>>{
 const counts:Partial<Record<PanelName,number>>={};
 for(const group of groups)for(const row of group.rows){const panel=panelNames.find(p=>p===row.target.panel);if(panel)counts[panel]=(counts[panel]??0)+1;}
 return counts;
}
