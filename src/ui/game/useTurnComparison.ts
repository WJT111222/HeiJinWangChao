import { useEffect,useMemo,useState } from 'react';
import type { GameState } from '../../domain/state';
import type { SaveRepository } from '../../services/storage/saveRepository';
import type { TurnComparison } from '../../services/storage/turnUndo';
import { diffTurn } from './turnChanges';

/** One confirmed read-only result for the entry and mobile directory; never cache across states. */
export function useTurnComparison(state:GameState,repository:SaveRepository,enabled:boolean){
 const request=useMemo(()=>({state,repository,enabled}),[state,repository,enabled]);
 const [result,setResult]=useState<{request:typeof request;data:TurnComparison}>();
 useEffect(()=>{if(!enabled)return;let active=true;repository.turnComparison(state).then(data=>{if(active)setResult({request,data});}).catch(()=>{if(active)setResult({request,data:{available:false,reason:'corrupt'}});});return()=>{active=false;};},[request]);
 const ready=enabled&&result?.request===request,comparison=ready?result.data:undefined;
 const groups=useMemo(()=>comparison?.available?diffTurn(comparison.before,state):[],[comparison,state]);
 return {ready,groups,count:groups.reduce((total,g)=>total+g.rows.length,0),unavailable:Boolean(comparison&&!comparison.available)};
}
export type TurnChangesView=ReturnType<typeof useTurnComparison>;
