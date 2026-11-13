import type { PlayerView } from './playerView';
export type Place=PlayerView['locations'][number];
/** Read-only display forest. Raw parentId is retained, including malformed input. */
export function mapProjection(locations:readonly Place[],currentId:string,npcs:readonly {locationId?:string}[]=[]){
 const nodes=new Map(locations.map(p=>[p.id,p])),parent=new Map<string,string>(),issues=new Map<string,string>();
 for(const p of locations)if(p.parentId){if(nodes.has(p.parentId))parent.set(p.id,p.parentId);else issues.set(p.id,'上级地点记录缺失，按独立档案显示。');}
 const done=new Set<string>();
 for(const p of locations){let id:string|undefined=p.id;const path:string[]=[],seen=new Map<string,number>();
  while(id&&!done.has(id)){if(seen.has(id)){const cycle=path.slice(seen.get(id)!);parent.delete(cycle[0]);for(const c of cycle)issues.set(c,'地点层级存在循环，展示已停止回绕；原始关系保留。');break;}seen.set(id,path.length);path.push(id);id=parent.get(id);}
  path.forEach(x=>done.add(x));
 }
 const children=new Map<string,Place[]>(),roots:Place[]=[];
 for(const p of locations){const up=parent.get(p.id);if(up){const row=children.get(up)??[];row.push(p);children.set(up,row);}else roots.push(p);}
 const order:Place[]=[],stack=[...roots].reverse();while(stack.length){const p=stack.pop()!;order.push(p);stack.push(...[...(children.get(p.id)??[])].reverse());}
 const descendants=new Map<string,number>(),people=new Map<string,number>();for(const n of npcs)if(n.locationId&&nodes.has(n.locationId))people.set(n.locationId,(people.get(n.locationId)??0)+1);
 for(const p of [...order].reverse()){const up=parent.get(p.id);if(up){descendants.set(up,(descendants.get(up)??0)+1+(descendants.get(p.id)??0));people.set(up,(people.get(up)??0)+(people.get(p.id)??0));}}
 const path=(id:string)=>{const out:Place[]=[];let p=nodes.get(id);while(p){out.unshift(p);p=nodes.get(parent.get(p.id)??'');}return out;};
 const leaves=(id:string)=>{const out:Place[]=[],pending=[...(children.get(id)??[])].reverse();while(pending.length){const p=pending.pop()!,ks=children.get(p.id)??[];if(ks.length)pending.push(...[...ks].reverse());else out.push(p);}return out;};
 return {nodes,parent,children,roots,order,issues,descendants,people,path,leaves,currentPath:path(currentId)};
}
export interface MapUiState {layer?:string;selected?:string;expanded:string[];query:string;limits:Record<string,number>}
