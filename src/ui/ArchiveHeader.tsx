/** One shared archive chrome for nonmodal readers and the stable settings dialog. */
export interface ArchiveHeading {
 title:string;seal:string;subtitle:string;eyebrow?:string;index?:number;total?:number;
}
export function ArchiveHeader({title,seal,subtitle,eyebrow,index=1,total=7,titleId,onClose,closeLabel='关闭资料界面'}:ArchiveHeading&{titleId:string;onClose:()=>void;closeLabel?:string}) {
 return <header className="ar-head"><span className="seal" aria-hidden="true">{seal}</span>
  <div className="ar-title"><span className="eyebrow" aria-hidden="true">{eyebrow??`WORLD ARCHIVE · ${String(index).padStart(2,'0')} / ${String(total).padStart(2,'0')}`}</span><h2 id={titleId}>{title}</h2><span className="sub" title={subtitle}>{subtitle}</span></div>
  <span className="esc" aria-hidden="true">ESC</span><button type="button" className="ar-close" aria-label={closeLabel} onClick={onClose}>关闭 ×</button>
 </header>;
}
