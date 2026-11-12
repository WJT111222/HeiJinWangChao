import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import type {TurnDraft} from '../../domain/drafts';
import type {RuntimeLogEntry} from './runtimeLog';
import {requestInspections} from '../../services/ai/inspection';
import {assessSummary} from '../../domain/memories/summary';
import {Dialog} from '../Dialog';
import {RuntimeLogPanel} from './RuntimeLogPanel';
import {RequestUsage} from './RequestUsage';
import {StageResponsesPanel} from './StageResponsesPanel';
import {StoryInspectionPanel} from './StoryInspectionPanel';

const tabs=['概要','运行日志','请求用量','模型原文','叙事规划'] as const;
export function MobileDiagnostics({saveId,turnId,draft,entries,onClear,open,onOpen,onClose}:{saveId:string;turnId?:string;draft?:TurnDraft;entries:readonly RuntimeLogEntry[];onClear:()=>void;open:boolean;onOpen:()=>void;onClose:()=>void}){
 const id=useId(),[tab,setTab]=useState<typeof tabs[number]>('概要'),latest=entries.filter(e=>e.kind==='failed').at(-1)?.id,seen=useRef<number|undefined>(undefined),openLatest=useRef(onOpen);openLatest.current=onOpen;
 const records=useSyncExternalStore(requestInspections.subscribe,requestInspections.getSnapshot),requests=records.filter(r=>r.scope?.saveId===saveId&&r.stage!=='memory').slice(0,6);
 useEffect(()=>{if(latest!==undefined&&latest!==seen.current){seen.current=latest;setTab('运行日志');openLatest.current();}},[latest]);
 const errors=entries.filter(e=>e.kind==='failed'),summary=draft?.story?assessSummary(draft.story.summary):undefined;
 if(!open)return null;
 return <Dialog title="重试与变更详情" seal="诊" eyebrow="WORKFLOW · 诊断" mobileVariant="sheet" sheetFull className="mobile-diagnostics-sheet" onClose={onClose}>
  <div role="tablist" aria-label="诊断分类" className="mobile-diagnostic-tabs" onKeyDown={event=>{
   const n=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(n+1)%tabs.length:event.key==='ArrowLeft'?(n+tabs.length-1)%tabs.length:undefined;
   if(next===undefined)return;event.preventDefault();setTab(tabs[next]);document.getElementById(`${id}-tab-${next}`)?.focus();
  }}>{tabs.map((name,index)=><button key={name} role="tab" id={`${id}-tab-${index}`} aria-selected={tab===name} tabIndex={tab===name?0:-1} aria-controls={`${id}-panel`} onClick={()=>setTab(name)}>{name}{name==='运行日志'&&<span className="n error-count">{errors.length}</span>}{name==='请求用量'&&<span className="n">{requests.length}</span>}</button>)}</div>
  <section role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tabs.indexOf(tab)}`} tabIndex={0}>
   {tab==='概要'&&<>
    <div className="diagnostic-metrics"><div><small>运行记录</small><b>{entries.length}</b></div><div><small>错误</small><b>{errors.length}</b></div><div><small>显示的请求</small><b>{requests.length}</b></div></div>
    {summary&&<p className="muted" data-testid="summary-length">本回合摘要：{summary.hanCharacters} 汉字。{summary.status==='empty'?'缺少有效摘要，无法正式结算。':summary.status==='within_target'?'符合目标范围。':'可继续。'}</p>}
    {draft?.failures.filter(f=>f.storyRevision===draft.storyRevision).slice(-6).map((f,i)=><p className="muted" key={i}>{{story:'正文生成',variables:'变量管理',world:'动态世界'}[f.stage]} · 安全失败码：{f.errorCode}</p>)}
    <p className="muted">仅显示现有临时诊断；候选与原始响应不等于正式世界或人物认知。</p>
   </>}
   {tab==='运行日志'&&<RuntimeLogPanel entries={entries} onClear={onClear}/>}
   {tab==='请求用量'&&<RequestUsage saveId={saveId}/>}
   {tab==='模型原文'&&<StageResponsesPanel saveId={saveId} turnId={turnId}/>}
   {tab==='叙事规划'&&draft&&<StoryInspectionPanel key={`${draft.turnId}-${draft.storyRevision}`} draft={draft}/>}
  </section><p className="diagnostic-temporary">仅本页临时保存 · 刷新即清空</p>
 </Dialog>;
}
