import { useEffect,useId,useMemo,useState } from 'react';
import type { GameState } from '../../domain/state';
import type { SaveRepository } from '../../services/storage/saveRepository';
import type { TurnComparison } from '../../services/storage/turnUndo';
import { diffTurn } from './turnChanges';
import type { ChangeGroup,ChangeRow,ChangeTarget } from './turnChanges';
import './turn-changes.css';

function Row({row,onOpen}:{row:ChangeRow;onOpen:(target:ChangeTarget)=>void}){
 return <li><button type="button" className="chg-row" onClick={()=>onOpen(row.target)}><span className="what">{row.field?<><em>{row.subject}</em>{row.field}</>:row.subject}</span>
  <span className={`val ${row.tone}`}>{row.time?<><span className="from">{row.oldValue}</span> → <span className="to">{row.newValue}</span></>:<span className={['add','del','mod'].includes(row.tone)?'change-tag':undefined}>{row.value}</span>}</span>
  {row.detail&&<span className="txt">{row.detail}</span>}<span className="go">{row.target.panel==='NPC'?'NPC 人物资料':row.target.panel} <span aria-hidden="true">↗</span></span></button></li>;
}
function Group({group,onOpen}:{group:ChangeGroup;onOpen:(target:ChangeTarget)=>void}){
 const [all,setAll]=useState(false),id=useId(),remaining=group.rows.length-8;
 return <section className={`chg-grp g-${group.key}`} aria-label={group.label}><h4><i aria-hidden="true"/>{group.label}<span>{group.rows.length}</span></h4>
  <ul id={id}>{group.rows.slice(0,all?undefined:8).map(row=><Row key={row.key} row={row} onOpen={onOpen}/>)}</ul>
  {remaining>0&&<button type="button" className="chg-more" aria-expanded={all} aria-controls={id} onClick={()=>setAll(!all)}>{all?'收起其余':'还有'} {remaining} 条</button>}
 </section>;
}
export function TurnChanges({state,repository,onOpen}:{state:GameState;repository:SaveRepository;onOpen:(target:ChangeTarget)=>void}){
 const id=useId(),[result,setResult]=useState<{state:GameState;data:TurnComparison}>(),[open,setOpen]=useState(false);
 useEffect(()=>{let active=true;repository.turnComparison(state).then(data=>{if(active)setResult({state,data});}).catch(()=>{if(active)setResult({state,data:{available:false,reason:'corrupt'}});});return()=>{active=false;};},[repository,state]);
 const ready=result?.state===state,comparison=ready?result.data:undefined;
 const groups=useMemo(()=>comparison?.available?diffTurn(comparison.before,state):[],[comparison,state]);
 const count=groups.reduce((total,g)=>total+g.rows.length,0),unavailable=Boolean(comparison&&!comparison.available);
 return <div className="turn-changes chg" onKeyDown={event=>{if(/^[1-5]$/.test(event.key)||(event.key==='Enter'&&(event.ctrlKey||event.metaKey)))event.stopPropagation();}}>
  <button type="button" className="chg-btn" disabled={!ready||unavailable||!count} aria-expanded={open&&count>0&&!unavailable} aria-controls={id} aria-describedby={!ready||unavailable?`${id}-note`:undefined} onClick={()=>setOpen(!open)}>
   <b>本回合变化</b><span className="n">{!ready?'核对中':unavailable?'不可用':count?`${count} 项`:'· 无'}</span>
   <span className="dots" aria-hidden="true">{groups.map(g=><i className={`g-${g.key}`} key={g.key}/>)}</span><span className="arr" aria-hidden="true">▼</span>
  </button>
  {(!ready||unavailable)&&<p className="chg-note" id={`${id}-note`} role="status">{unavailable?'本回合没有可对比的结算前记录':'正在核对本回合结算前记录…'}</p>}
  <div className="chg-body" id={id} role="region" aria-label="本回合变化" hidden={!open||!ready||unavailable||!count}>
   {open&&ready&&!unavailable&&groups.map(group=><Group key={group.key} group={group} onOpen={onOpen}/>)}
   <p className="chg-foot">与本回合开始时相比 · 点任一行打开对应资料 · 不影响存档</p>
  </div>
 </div>;
}
