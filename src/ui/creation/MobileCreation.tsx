import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CITY, CITY_TICKET_META } from '../home/skyline';
import { guilloche } from '../home/ticketView';
import { cities, professionProfile } from './model';
import type { Creation } from './model';

export const creationCity={chongqing:'cq',shanghai:'sh',harbin:'hrb',guangzhou:'gz'} as const;
export const ticketMeta={cq:{...CITY_TICKET_META.cq,band:'#2f6f63'},sh:{...CITY_TICKET_META.sh,band:'#34468e'},hrb:{...CITY_TICKET_META.hrb,band:'#6f8fa8'},gz:{...CITY_TICKET_META.gz,band:'#a8482c'}};
export function CreationGuilloche({city}:{city:Creation['city']}) {
  return <svg viewBox="0 0 320 74" preserveAspectRatio="none" aria-hidden="true">{guilloche(creationCity[city]).map((d,k)=><path key={k} className={k%4?'':'deep'} d={d}/>)}</svg>;
}
export function MiniCreationTicket({form,onPreview}:{form:Creation;onPreview:()=>void}) {
 const profile=professionProfile(form),city=cities.find(c=>c.id===form.city)!,meta=ticketMeta[creationCity[form.city]];
 const completed=[form.person.name&&form.person.age&&form.person.gender,profile.name,form.step>3||form.background,form.step>4||form.hasCompanion,form.openingPreference].filter(Boolean).length;
 return <button type="button" className="creation-mini-ticket" onClick={onPreview} aria-label="展开完整车票预览" style={{'--band':form.step>=3?meta.band:'#c9a961'} as CSSProperties}>
  <span className="creation-color-strip"/><span className="mini-ticket-body"><span className="mini-route"><span><small>FROM</small><b title={form.person.name}>{form.person.name||'？'}</b></span><i aria-hidden="true"/><span><small>TO</small><b>{form.step>=3?city.name:'？'}</b></span></span><span className="mini-info" title={`${form.person.age} · ${form.person.gender} · ${profile.name}`}>{form.person.age?`${form.person.age} 岁`:'年龄'} · {form.person.gender||'性别'} · {profile.name||'职业'}{form.hasCompanion&&form.companion.name?` · 同伴 ${form.companion.name}`:''}</span></span>
  <span className="mini-station"><small>STATION</small><b>0{form.step}</b><span><i style={{width:`${completed*20}%`}}/></span></span><span className="mini-expand" aria-hidden="true">展开 ›</span>
 </button>;
}
export function FullCreationTicket({form,stub}:{form:Creation;stub:ReactNode}) {
 const key=creationCity[form.city],meta=ticketMeta[key],city=cities.find(c=>c.id===form.city)!,on=form.step>=3,profile=professionProfile(form);
 return <article className="creation-full-ticket" aria-label="人生车票" style={{'--band':on?meta.band:'#c9a961','--tint':on?meta.tint:'#c9a961'} as CSSProperties}>
  <div className="creation-ticket-paper"><div className="creation-ticket-band"><b>{on?city.name:'空白车票'}</b><small>{on?CITY[key][1].split(' · ')[1]:'NEW LIFE'}</small><span>NEW LIFE</span></div>
  <div className="creation-ticket-route"><span><small>FROM</small><b>{form.person.name||'？'}</b></span><i aria-hidden="true">单程</i><span><small>TO</small><b>{on?city.name:'？'}</b></span></div>
  <dl><div><dt>年龄</dt><dd>{form.person.age||'—'}</dd></div><div><dt>性别</dt><dd>{form.person.gender||'—'}</dd></div><div><dt>职业</dt><dd>{profile.name||'—'}</dd></div></dl>
  <div className="creation-ticket-mid" aria-hidden="true"><CreationGuilloche city={form.city}/>{on&&<><span>{CITY[key][1].split(' · ')[1]} · {meta.longitude}</span><b>{CITY[key][2]}</b></>}<i>待开局<small>BOARDING</small></i></div></div>
  <div className="creation-ticket-perf" aria-hidden="true"/>{stub}
 </article>;
}
export function TemplateChips({label,value,options,onChange}:{label:string;value:string;options:readonly {name:string}[];onChange:(value:string)=>void}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const row=ref.current,on=row?.querySelector<HTMLElement>('[aria-checked=true]');if(row&&on)row.scrollTo({left:on.offsetLeft-(row.clientWidth-on.offsetWidth)/2,behavior:'instant'});},[value]);
 const items=[{name:'自由选择',value:'custom'},...options.map(o=>({name:o.name,value:o.name}))];
 return <div className="creation-template-chips" role="radiogroup" aria-label={label} ref={ref}>{items.map((option,i)=><button type="button" role="radio" aria-checked={value===option.value} tabIndex={value===option.value?0:-1} key={option.value} onClick={()=>onChange(option.value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowLeft'?-1:1)+items.length)%items.length;onChange(items[next].value);ref.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}}}>{option.name}</button>)}</div>;
}
export function CreationReviewCard({mobile,title,index,children}:{mobile:boolean;title:string;index:number;children:ReactNode}) {
 return mobile?<details className="card creation-review-fold" open={index===1||undefined}><summary><small>0{index}</small><b>{title}</b></summary>{children}</details>:<section className="card">{children}</section>;
}
