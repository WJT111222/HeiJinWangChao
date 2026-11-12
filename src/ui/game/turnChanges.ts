import type { GameState } from '../../domain/state';
import { fingerprint } from '../../domain/commands';
import { npcKnowledgeKind } from '../../domain/memories/schema';
import { playerView,money,dateTime } from '../panels/playerView';
import { protagonistInventory,itemDescription } from '../panels/inventory';
import { eventArchive,eventStatusLabels } from '../panels/eventArchive';
import { locationText } from './atmosphere';
import type { Level } from '../panels/MemoryPanel';

export type ChangeTarget={panel:'NPC'|'物品栏'|'势力组织'|'世界事件'|'地图';id?:string}
 |{panel:'人物档案'|'经济与资产'}|{panel:'历史时间轴';id?:string}|{panel:'记忆';level?:Level};
export interface ChangeRow {key:string;subject:string;field?:string;value:string;detail?:string;oldValue?:string;newValue?:string;time?:boolean;tone:'add'|'del'|'mod'|'up'|'down';target:ChangeTarget}
export interface ChangeGroup {key:'time'|'me'|'npc'|'item'|'world'|'mem';label:string;rows:ChangeRow[]}
const scope={player_known:'主角已知记录',npc_private:'人物私有记录 · 不代表主角已知',internal:'内部世界记录 · 不代表角色已知'};
const nature={observed:'亲历 / 观察',reported:'转述（未核实）',suspected:'推测（未确认）',unknown:'认知来源未分类'};
const text=(v:string|undefined)=>v?.trim()?v:'未记录';
const changed=(a:unknown,b:unknown)=>fingerprint(a)!==fingerprint(b);
const added=<T>(a:readonly T[],b:readonly T[],key:(v:T)=>string)=>{const seen=new Map<string,number>();for(const v of a){const k=key(v);seen.set(k,(seen.get(k)??0)+1);}return b.filter(v=>{const k=key(v),count=seen.get(k)??0;if(count){seen.set(k,count-1);return false;}return true;});};
function elapsed(a:string,b:string){const ms=Date.parse(b)-Date.parse(a),absolute=Math.abs(ms);
 const units=[['天',86400000],['小时',3600000],['分钟',60000],['秒',1000]] as const;let remaining=absolute;const parts:string[]=[];
 for(const [label,size] of units){const count=size===1000?remaining/1000:Math.floor(remaining/size);if(count){parts.push(`${count}${label}`);remaining-=count*size;}}
 return `${ms<0?'回溯':'经过'} ${parts.join(' ')||'0秒'}`;
}
/** Pure read-only presentation. Never interprets narrative or rewrites knowledge scope. */
export function diffTurn(before:GameState,after:GameState):ChangeGroup[]{
 const groups:ChangeGroup[]=[{key:'time',label:'时间与地点',rows:[]},{key:'me',label:'主角',rows:[]},{key:'npc',label:'人物',rows:[]},{key:'item',label:'物品',rows:[]},{key:'world',label:'世界',rows:[]},{key:'mem',label:'记忆与历史',rows:[]}];
 const [time,me,people,items,world,memories]=groups.map(g=>g.rows);
 const profile:ChangeTarget={panel:'人物档案'},map:ChangeTarget={panel:'地图',id:after.protagonist.locationId};
 function update(rows:ChangeRow[],key:string,subject:string,a:string,b:string,target:ChangeTarget,field?:string,force=false){if(force||a!==b)rows.push({key,subject,field,value:'变更',detail:`${a} → ${b}`,oldValue:a,newValue:b,tone:'mod',target});}
 const location=(state:GameState,id?:string)=>{if(!id)return '地点未记录';const value=locationText(state.locations,id);return [value.path,value.name].filter(Boolean).join(' › ');};
 if(Date.parse(before.worldClock)!==Date.parse(after.worldClock))time.push({key:'clock',subject:'时间',value:`${dateTime(before.worldClock)} → ${dateTime(after.worldClock)}`,oldValue:dateTime(before.worldClock),newValue:dateTime(after.worldClock),time:true,detail:elapsed(before.worldClock,after.worldClock),tone:'mod',target:profile});
 if(before.protagonist.locationId!==after.protagonist.locationId)update(time,'place','地点',location(before,before.protagonist.locationId),location(after,after.protagonist.locationId),map,undefined,true);
 update(time,'weather','天气',text(before.weatherText),text(after.weatherText),profile);
 update(time,'environment','环境',text(before.environmentText),text(after.environmentText),profile);
 for(const [key,label] of [['cash','现金'],['onlineBalance','线上资金']] as const){const a=before.economy[key],b=after.economy[key];if(a===b)continue;
  const delta=a!==null&&b!==null?BigInt(b)-BigInt(a):undefined;
  me.push({key,subject:label,value:delta===undefined?'变更':`${delta>0n?'+':''}${money(delta)}`,detail:`${money(a)} → ${money(b)}`,tone:delta===undefined?'mod':delta>0n?'up':'down',target:{panel:'经济与资产'}});
 }
 for(const [key,label] of [['healthText','身体'],['emotionText','情绪'],['publicStatus','社会状态'],['legalStatus','法律状态']] as const)update(me,key,label,text(before.protagonist[key]),text(after.protagonist[key]),profile);
 const wearNames=(state:GameState,key:keyof GameState['protagonist']['currentWear'])=>{
  const value=state.protagonist.currentWear[key],ids=Array.isArray(value)?value:value?[value]:[];
  return ids.length?ids.map(id=>key==='currentVehicleAssetId'?state.economy.vehicles[id]?.name??'原载具已移除':state.items[id]?.name??'原物品已移除').join('、'):'无';
 };
 for(const [key,label] of [['topItemId','上衣'],['bottomItemId','下装'],['shoesItemId','鞋子'],['accessoryItemIds','饰品'],['primaryWeaponItemId','主武器'],['secondaryWeaponItemId','副武器'],['currentVehicleAssetId','载具']] as const)
  if(changed(before.protagonist.currentWear[key],after.protagonist.currentWear[key]))me.push({key:`wear:${key}`,subject:label,value:'变更',detail:`${wearNames(before,key)} → ${wearNames(after,key)}`,tone:'mod',target:profile});
 const previousView=playerView(before),currentView=playerView(after),oldPeople=new Map(previousView.npc.map(n=>[n.id,n]));
 for(const person of currentView.npc){const old=oldPeople.get(person.id),target:ChangeTarget={panel:'NPC',id:person.id};
  if(!old){people.push({key:`npc:${person.id}`,subject:person.name,value:'新人物',detail:person.identity||'已加入人物资料',tone:'add',target});continue;}
  if(old.affinity!==person.affinity)people.push({key:`affinity:${person.id}`,subject:person.name,field:'关系倾向',value:`${old.affinity??'未确认'} → ${person.affinity??'未确认'}`,tone:old.affinity===null||person.affinity===null?'mod':person.affinity>old.affinity?'up':'down',target});
  update(people,`relationship:${person.id}`,person.name,old.relationshipText,person.relationshipText,target,'与主角关系');
  if(old.onScene!==person.onScene)people.push({key:`scene:${person.id}`,subject:person.name,value:person.onScene?'在场':'离场',tone:'mod',target});
  if(old.locationId!==person.locationId)update(people,`location:${person.id}`,person.name,location(before,old.locationId),location(after,person.locationId),target,'位置',true);
  const known=added(old.knownInformation,person.knownInformation,fingerprint);if(known.length)people.push({key:`known:${person.id}`,subject:person.name,field:'新增已知信息',value:`+${known.length} 条`,detail:`${known[0].text} · 来源：${known[0].source}`,tone:'add',target});
  for(const visibility of ['player_known','npc_private','internal'] as const)for(const kind of ['observed','reported','suspected','unknown'] as const){
   const entries=added(old.memories,person.memories,m=>m.id).filter(m=>m.visibility===visibility&&npcKnowledgeKind(m)===kind);
   if(entries.length)people.push({key:`npc-memory:${person.id}:${visibility}:${kind}`,subject:person.name,field:'新增人物记忆',value:`+${entries.length} 条`,detail:`${scope[visibility]} · ${nature[kind]} · ${entries[0].text}`,tone:'add',target});
  }
 }
 const oldInventory=protagonistInventory(previousView.items,before.protagonist),newInventory=protagonistInventory(currentView.items,after.protagonist),oldItems=new Map(oldInventory.items.map(i=>[i.id,i])),newItems=new Map(newInventory.items.map(i=>[i.id,i]));
 for(const item of newInventory.items){const old=oldItems.get(item.id),target:ChangeTarget={panel:'物品栏',id:item.id};
  if(!old)items.push({key:`item:${item.id}`,subject:item.name,value:'获得',detail:`×${item.quantity} · ${itemDescription(item)}`,tone:'add',target});
  else{
   if(old.quantity!==item.quantity){const delta=BigInt(item.quantity)-BigInt(old.quantity);items.push({key:`quantity:${item.id}`,subject:item.name,field:'数量',value:`×${old.quantity} → ×${item.quantity}`,detail:`${delta>0n?'+':''}${delta} 件`,tone:delta>0n?'up':'down',target});}
   update(items,`condition:${item.id}`,item.name,text(old.conditionText),text(item.conditionText),target,'状态');
   if(oldInventory.equipped.has(item.id)!==newInventory.equipped.has(item.id))items.push({key:`equipped:${item.id}`,subject:item.name,value:newInventory.equipped.has(item.id)?'已装备':'卸下装备',tone:'mod',target});
  }
 }
 for(const item of oldInventory.items)if(!newItems.has(item.id))items.push({key:`lost:${item.id}`,subject:item.name,value:'失去',detail:`×${item.quantity} · 当前主角物品栏中已无此物品`,tone:'del',target:{panel:'物品栏'}});
 for(const org of currentView.organizations){const old=before.organizations[org.id],target:ChangeTarget={panel:'势力组织',id:org.id};
  if(!old)world.push({key:`org:${org.id}`,subject:org.name,value:'新组织',detail:text(org.description),tone:'add',target});
  else{
   update(world,`org-relation:${org.id}`,org.name,old.protagonistRelation,org.protagonistRelation,target,'与主角关系');
   for(const relation of org.relations??[]){const was=old.relations?.find(r=>r.organizationId===relation.organizationId);if(changed(was,relation))world.push({key:`org-peer:${org.id}:${relation.organizationId}`,subject:org.name,field:'势力关系',value:'变更',detail:`${after.organizations[relation.organizationId]?.name??'历史组织'}：${was?`${was.relation}${was.description?` · ${was.description}`:''}`:'未记录'} → ${relation.relation}${relation.description?` · ${relation.description}`:''}`,tone:'mod',target});}
   for(const relation of old.relations??[])if(!org.relations?.some(r=>r.organizationId===relation.organizationId))world.push({key:`org-peer-removed:${org.id}:${relation.organizationId}`,subject:org.name,field:'势力关系',value:'移除',detail:`${before.organizations[relation.organizationId]?.name??'历史组织'} · ${relation.relation}`,tone:'del',target});
  }
 }
 const priorEvents=eventArchive(previousView),events=eventArchive(currentView),worldNote='客观世界档案 · 不代表主角新增知情';
 for(const event of events.records.values()){const old=priorEvents.records.get(event.id),title=event.detail?.title??old?.detail?.title??'历史事件',target:ChangeTarget={panel:'世界事件',id:event.id};
  if(!old)world.push({key:`event:${event.id}`,subject:title,value:event.eventKind==='sub'?'新阶段':'新事件',detail:`${worldNote} · ${eventStatusLabels[event.status]}${event.fixedEndAt?` · 固定结束：${dateTime(event.fixedEndAt)}`:''}`,tone:event.eventKind==='sub'?'mod':'add',target});
  else{
   if(old.status!==event.status)world.push({key:`event-status:${event.id}`,subject:title,value:`${eventStatusLabels[old.status]} → ${eventStatusLabels[event.status]}`,detail:worldNote,tone:'mod',target});
   if(old.retired!==event.retired)world.push({key:`event-archive:${event.id}`,subject:title,value:'转入历史档案',detail:worldNote,tone:'mod',target});
   if(old.fixedEndAt!==event.fixedEndAt)update(world,`fixed:${event.id}`,title,old.fixedEndAt?dateTime(old.fixedEndAt):'未记录',event.fixedEndAt?dateTime(event.fixedEndAt):'未记录',target,'固定结束时刻');
   if(event.detail?.resolutionText!==old.detail?.resolutionText&&event.detail?.resolutionText)world.push({key:`result:${event.id}`,subject:title,field:'正式结果叙述',value:'变更',detail:`${worldNote} · 完整叙述不代表每句均已核实：${event.detail.resolutionText}`,tone:'mod',target});
  }
  for(const [kind,label] of [['facts','已核实事实'],['reported','转述（未核实）'],['suspected','推测（未确认）']] as const){const entries=added(old?.detail?.resultKnowledge?.[kind]??[],event.detail?.resultKnowledge?.[kind]??[],v=>v);if(entries.length)world.push({key:`event-knowledge:${event.id}:${kind}`,subject:title,field:label,value:`+${entries.length} 条`,detail:`${worldNote} · ${entries.join('；')}`,tone:'add',target});}
 }
 const taskNames={planned:'已规划',active:'进行中',completed:'已完成',blocked:'受阻',cancelled:'已取消'};
 for(const task of currentView.tasks){const old=before.tasks[task.id],target:ChangeTarget={panel:'世界事件',...(task.linkedEventId&&events.records.has(task.linkedEventId)?{id:task.linkedEventId}:{})};
  if(!old||old.status!==task.status)world.push({key:`task:${task.id}`,subject:task.goal,field:'任务',value:old?`${taskNames[old.status]} → ${taskNames[task.status]}`:'新任务',detail:worldNote,tone:old?'mod':'add',target});
 }
 for(const place of currentView.locations)if(!before.locations[place.id])world.push({key:`place:${place.id}`,subject:place.name,value:'新地点',tone:'add',target:{panel:'地图',id:place.id}});
 // Use the same observed archive projection as MemoryPanel, excluding derived journal aliases.
 const oldMemoryKeys=new Set(previousView.memories.filter(m=>m.origin==='stored').map(m=>m.recordKey));
 const newMemories=currentView.memories.filter(m=>m.origin==='stored'&&!oldMemoryKeys.has(m.recordKey));
 for(const [tier,label] of [['short','短期记忆'],['medium','中期记忆'],['long','长期记忆'],['npc','人物记忆与总结']] as const)
  for(const visibility of ['player_known','npc_private','internal'] as const)for(const kind of ['observed','reported','suspected','unknown'] as const){
   const entries=newMemories.filter(m=>m.tier===tier&&m.visibility===visibility&&(m.knowledgeKind??'unknown')===kind);
   if(entries.length)memories.push({key:`memory:${tier}:${visibility}:${kind}`,subject:label,value:`+${entries.length} 条`,detail:`${scope[visibility]}${tier==='npc'||entries.some(m=>m.knowledgeKind!==undefined)?` · ${nature[kind]}`:''} · ${entries[0].text}`,tone:'add',target:{panel:'记忆',level:tier}});
  }
 const history=added(before.timeline,after.timeline,h=>h.id),historyNature={established:'剧情事实',reported:'人物陈述',suspected:'推测 / 传闻'};
 for(const [category,label] of [['world','世界重大纪事'],['protagonist','主角重大纪事'],['records','史料记录']] as const){const entries=history.filter(h=>(h.chronicle?.category??'records')===category);if(entries.length)memories.push({key:`history:${category}`,subject:label,value:`+${entries.length} 条`,detail:`${historyNature[entries[0].knowledgeKind]} · ${entries[0].title}：${entries[0].summary}`,tone:'add',target:{panel:'历史时间轴',...(entries[0].chronicle?{id:entries[0].id}:{})}});}
 return groups.filter(g=>g.rows.length);
}
