import type { CSSProperties, ReactNode } from 'react';
import type { PlayerView } from './playerView';
import { money, dateTime } from './playerView';
import { Empty } from '../Dialog';
import { RecordList, WorldRecord } from './WorldRecord';
import { accountLabels, amountSummary, debtLabels, debtProgress, incomeLabels, ownedAssets } from './economyView';

function Records<T>({ label, entries, text, render }: { label:string;entries:readonly T[];text:(entry:T)=>string;render:(entry:T)=>ReactNode }) {
  return entries.length>20 ? <RecordList label={label} entries={entries} text={text} render={render} />
    : <div role="region" aria-label={label}>{entries.map((entry,i)=><div key={i}>{render(entry)}</div>)}</div>;
}
function Amount({ value }: { value:number|bigint|null }) {
  const text=money(value);
  const width=Array.from(text).reduce((n,c)=>n+(c.charCodeAt(0)>127?1:.62),0);
  return <b className="metric-amount" style={{'--amount-width':width} as CSSProperties}>{text.endsWith(' 元') ? <>{text.slice(0,-2)}<em> 元</em></> : text}</b>;
}
function Summary({ value, noun }: { value:ReturnType<typeof amountSummary>;noun:string }) {
  return <><Amount value={value.amount}/><p>{value.unknownCount ? value.knownCount ? `已知部分；${value.unknownCount} ${noun}金额未确认，合计不完整。` : `${value.unknownCount} ${noun}金额未确认，无法计算合计。` : `${value.count} ${noun}`}</p></>;
}
function AssetIcon({ kind }: {kind:'property'|'vehicle'|'other'}) {
  const paths={property:'M3 11 12 4l9 7 M5 10v10h14V10 M10 20v-6h4v6',vehicle:'M3 15l2-6h14l2 6v4H3z M7 19v2 M17 19v2 M6 15h2 M16 15h2',other:'m3 7 9-4 9 4-9 4Z M3 7v12l9 3 9-3V7 M12 11v11'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>;
}

/** Desktop-only projection. No financial commands, transactions or inferred fields. */
export function EconomyPanel({ view }: { view:PlayerView }) {
  const assets=ownedAssets(view),incomes=Object.values(view.economy.incomes),debts=Object.values(view.economy.debts);
  const active=debts.filter(d=>d.status==='active');
  const assetSummary=amountSummary(assets.map(a=>a.estimatedValue)),debtSummary=amountSummary(active.map(d=>d.outstanding));
  const location=(id:string)=>view.locations.find(p=>p.id===id)?.name || '地点未确认';
  return <div className="eco">
    <div className="metric-row" aria-label="资金与派生合计">
      <section className="metric m-cash" aria-label="现金"><small><i aria-hidden="true">现</i>现金</small><Amount value={view.economy.cash}/></section>
      <section className="metric m-online" aria-label="线上资金"><small><i aria-hidden="true">线</i>线上资金</small><Amount value={view.economy.onlineBalance}/></section>
      <section className="metric m-debt derived" aria-label="未偿本金合计"><small><i aria-hidden="true">债</i>未偿本金合计</small><Summary value={debtSummary} noun="笔债务"/><p>{active.length} 笔偿还中 · 仅统计偿还中债务</p></section>
      <section className="metric m-asset derived" aria-label="资产估值合计"><small><i aria-hidden="true">资</i>资产估值合计</small><Summary value={assetSummary} noun="项资产"/></section>
    </div>
    <div className="eco-grid"><div>
      <section className="sec"><h3>收入</h3>{incomes.length ? <Records label="收入记录" entries={incomes} text={i=>`${i.source} ${i.scheduleText||''} ${incomeLabels[i.status]}`} render={income=><article className={`ledger-row ${income.status}`}>
        <h4>{income.source}</h4><span className="amt" data-known={income.amount!==null}>{money(income.amount)}</span>
        <div className="sub"><span className={`st ${income.status}`}>{incomeLabels[income.status]}</span><span>入账账户：{accountLabels[income.account]}</span>
          {income.expectedAt&&<span>预计 {dateTime(income.expectedAt)}</span>}{income.receivedAt&&<span>到账 {dateTime(income.receivedAt)}</span>}<span>{income.scheduleText}</span></div>
        <WorldRecord title="收入完整记录" value={income}/>
      </article>}/> : <Empty>暂无收入记录</Empty>}</section>
      <section className="sec"><h3>债务</h3>{debts.length ? <Records label="债务记录" entries={debts} text={d=>`${d.creditor} ${d.repaymentTerms} ${d.source} ${debtLabels[d.status]}`} render={debt=>{
        const progress=debtProgress(debt.principal,debt.outstanding);
        return <article className="debt" data-debt-id={debt.id}>
          <div className="hd"><h4>{debt.creditor}</h4><span className={`st ${debt.status}`}>{debtLabels[debt.status]}</span></div>
          <div className="nums"><span>本金 <b>{money(debt.principal)}</b></span><span>未偿本金 <b>{money(debt.outstanding)}</b></span>{debt.dueAt&&<span>到期 <b>{dateTime(debt.dueAt)}</b></span>}</div>
          {progress.width!==undefined&&<div className="debt-bar" role="progressbar" aria-label="未偿本金占比" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.width} aria-valuetext={`本金 ${money(debt.principal)}；未偿本金 ${money(debt.outstanding)}`}><i style={{width:`${progress.width}%`}}/></div>}
          {progress.note&&<p className="debt-progress-note">{progress.note}</p>}<p>{debt.repaymentTerms}</p>
          <WorldRecord title="债务完整记录" value={debt}/>
        </article>;
      }}/> : <Empty>暂无债务记录</Empty>}</section>
    </div><div>
      <section className="sec"><h3>资产</h3>{(['property','vehicle','other'] as const).map((kind,index)=>{
        const entries=assets.filter(a=>a.kind===kind),label=['房产','车辆','其他资产'][index];
        return <section key={kind}><div className="asset-k"><h4>{label}</h4><span>{entries.length}</span></div>
          {entries.length ? <Records label={`${label}记录`} entries={entries} text={a=>`${a.name} ${a.statusText} ${a.source}`} render={asset=><article className="asset" data-asset-id={asset.id}>
            <span className="ic"><AssetIcon kind={asset.kind}/></span><h4>{asset.name}</h4><span className={`val ${asset.estimatedValue===null?'null':''}`}>估值 {money(asset.estimatedValue)}</span>
            {asset.kind==='vehicle'&&<span className="src">{asset.model}{asset.plate?` · ${asset.plate}`:''}{asset.id===view.protagonist.currentWear.currentVehicleAssetId?' · 当前载具':''}</span>}
            <span className="st">{asset.statusText}</span><span className="src">来源：{asset.source}</span>
            {'locationId' in asset&&asset.locationId&&<span className="src">地点：{location(asset.locationId)}</span>}
            {asset.acquiredAt&&<span className="src">取得时间：{dateTime(asset.acquiredAt)}</span>}
            {asset.kind==='property'&&<span className="src">权属：{asset.ownershipText}</span>}
            {asset.kind==='other'&&<span className="src">{asset.category} · {asset.details}</span>}
            <WorldRecord title="资产完整记录" value={asset}/>
          </article>}/> : <Empty>暂无记录</Empty>}
        </section>;
      })}</section>
    </div></div>
  </div>;
}
