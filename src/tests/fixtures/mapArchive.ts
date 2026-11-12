import {archiveReadingState} from './archiveReading';
import {archiveAssetsState} from './archiveAssets';
import {GameStateSchema} from '../../domain/state';
/** Synthetic hierarchy, independent of design demo data. */
export function mapArchiveState(extra=0){
 const state=archiveReadingState(),assets=archiveAssetsState();
 Object.assign(state.locations,{
  'map-region':{id:'map-region',name:'沿江资料区',parentId:'chongqing'},
  'map-street':{id:'map-street',name:'阅览街',parentId:'map-region'},
  'map-old-block':{id:'map-old-block',name:'旧厂房街区',parentId:'map-street'},
  'map-cafe':{id:'map-cafe',name:'街角阅览室',parentId:'map-old-block'},
  'map-home':{id:'map-home',name:'旧宿舍',parentId:'map-street'},
  'map-overseas':{id:'map-overseas',name:'海外地点档案'},
  'map-abroad':{id:'map-abroad',name:'国外的工作地点',parentId:'map-overseas'},
  'map-cross-city':{id:'map-cross-city',name:'跨城关联的旧地点',parentId:'map-abroad'},
  'map-empty':{id:'map-empty',name:'尚无下级记录的地点'},
 });
 state.protagonist.locationId='map-cafe';
 for(const npc of Object.values(state.npc))npc.onScene=false;
 const person=state.npc['archive-researcher'];person.locationId='map-cafe';person.onScene=true;person.usualLocations=[{locationId:'map-cafe',role:'work',knownToProtagonist:false}];
 state.npc['npc-a'].locationId='map-abroad';
 state.events['main-stage'].locationId='map-cafe';
 state.economy.properties['map-property']={...assets.economy.properties['asset-home'],id:'map-property',locationId:'map-cafe',mortgageDebtId:undefined};
 state.economy.vehicles['map-car']={...assets.economy.vehicles.car,id:'map-car',locationId:'map-cafe'};
 for(let i=0;i<extra;i++){const id=`map-extra-${String(i).padStart(4,'0')}`;state.locations[id]={id,name:`地点档案${i}`,parentId:'map-region'};}
 if(extra)state.locations['map-extra-0000'].name='异常长地点名称'.repeat(35)+'W'.repeat(300);
 return GameStateSchema.parse(state);
}
