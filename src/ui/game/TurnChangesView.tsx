import { useId,useRef,useState } from 'react';
import type { GameState } from '../../domain/state';
import { Dialog } from '../Dialog';
import type { TurnChangesView } from './useTurnComparison';
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
export function TurnChanges({state,comparison,mobile=false,onOpen}:{state:GameState;comparison:TurnChangesView;mobile?:boolean;onOpen:(target:ChangeTarget)=>void}){
 const id=useId(),button=useRef<HTMLButtonElement>(null),[openedState,setOpenedState]=useState<GameState>();
 const {ready,groups,count,unavailable}=comparison,open=Boolean(openedState)&&(!mobile||openedState===state)&&ready&&!unavailable&&count>0;
 const close=()=>{setOpenedState(undefined);requestAnimationFrame(()=>{if(button.current?.isConnected&&!document.querySelector('dialog[open]'))button.current.focus({preventScroll:true});});};
 const select=(target:ChangeTarget)=>{if(mobile)setOpenedState(undefined);onOpen(target);};
 const content=<>{groups.map(group=><Group key={group.key} group={group} onOpen={select}/>)}<p className="chg-foot">与本回合开始时相比 · 点任一行打开对应资料 · 不影响存档</p></>;
 return <div className="turn-changes chg" onKeyDown={event=>{if(/^[1-5]$/.test(event.key)||(event.key==='Enter'&&(event.ctrlKey||event.metaKey)))event.stopPropagation();}}>
  <button ref={button} type="button" className="chg-btn" disabled={!ready||unavailable||!count} aria-expanded={open} aria-controls={id} aria-describedby={!ready||unavailable?`${id}-note`:undefined} onClick={()=>setOpenedState(open?undefined:state)}>
   <b>本回合变化</b><span className="n">{!ready?'核对中':unavailable?'不可用':count?`${count} 项`:'· 无'}</span>
   <span className="dots" aria-hidden="true">{groups.map(g=><i className={`g-${g.key}`} key={g.key}/>)}</span><span className="arr" aria-hidden="true">▼</span>
  </button>
  {(!ready||unavailable)&&<p className="chg-note" id={`${id}-note`} role="status">{unavailable?'本回合没有可对比的结算前记录':'正在核对本回合结算前记录…'}</p>}
  {mobile?open&&<Dialog title="本回合变化" seal="变" eyebrow={`THIS TURN · 第 ${state.turnNumber} 回`} mobileVariant="sheet" sheetFull className="turn-changes-sheet" onClose={close} returnFocus={()=>button.current}>
   <div className="chg-summary"><b>{count}</b>项变化<span className="dots" aria-hidden="true">{groups.map(g=><i className={`g-${g.key}`} key={g.key}/>)}</span></div>
   <div className="chg-body" id={id} role="region" aria-label="本回合变化">{content}</div>
  </Dialog>:<div className="chg-body" id={id} role="region" aria-label="本回合变化" hidden={!open}>{open&&content}</div>}
 </div>;
}
