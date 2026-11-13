import { GameStateSchema } from '../../domain/state';
import { mapArchiveState } from './mapArchive';
import { archiveAssetsState } from './archiveAssets';

/** Synthetic UI acceptance world; never imported by product code. */
export function mobileArchivesState(extra=0) {
 const state=mapArchiveState(extra),assets=archiveAssetsState(extra);
 const id=(value:string)=>`ui5-${value}`;
 for(const table of [assets.items,assets.economy.incomes,assets.economy.debts,assets.economy.properties,assets.economy.vehicles,assets.economy.otherAssets])for(const [key,record] of Object.entries(table)){delete (table as Record<string,unknown>)[key];record.id=id(key);(table as Record<string,unknown>)[record.id]=record;}
 for(const item of Object.values(assets.items))if(item.ownerRef?.kind==='npc')item.ownerRef.id='npc-a';
 for(const asset of [...Object.values(assets.economy.properties),...Object.values(assets.economy.vehicles),...Object.values(assets.economy.otherAssets)])if(asset.ownerRef.kind==='npc')asset.ownerRef.id='npc-a';
 for(const debt of Object.values(assets.economy.debts))debt.collateralAssetIds=debt.collateralAssetIds.map(id);
 for(const asset of Object.values(assets.economy.properties))if(asset.mortgageDebtId)asset.mortgageDebtId=id(asset.mortgageDebtId);
 state.items=assets.items;state.economy=assets.economy;
 state.protagonist.currentWear={accessoryItemIds:[],...Object.fromEntries(Object.entries(assets.protagonist.currentWear).map(([key,value])=>[key,Array.isArray(value)?value.map(id):typeof value==='string'?id(value):value]))};
 for(const item of Object.values(state.items))if(item.createdByTurnId)item.createdByTurnId=state.journal[0].turnId;
 for(const income of Object.values(state.economy.incomes))if(income.sourceTurnId)income.sourceTurnId=state.journal[0].turnId;
 if(extra){
  const world=state.timeline.find(h=>h.id==='world-opening')!,ordinary=state.timeline.find(h=>h.id==='old-report')!;
  for(let i=0;i<6;i++){const entry=structuredClone(world);entry.id=`ui5-history-${i}`;entry.title=`同刻资料记载第${i}则`;entry.chronicle!.milestoneId=`ui5-milestone-${i}`;state.timeline.push(entry);}
  for(let i=0;i<24;i++){const entry=structuredClone(ordinary);entry.id=`ui5-source-${i}`;entry.title=`往事史料第${i}则`;state.timeline.push(entry);}
 }
 state.title='手机档案纸验收';
 return GameStateSchema.parse(state);
}
