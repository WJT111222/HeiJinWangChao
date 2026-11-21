import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '../../domain/state';
import { atPath, changesBetween, editAtPath, parsePointer, pointer, validateVariableEdit } from '../../domain/playerVariables';
import type { SaveRepository, VariableSnapshot } from '../../services/storage/saveRepository';
import './variable-manager.css';

const names: Record<string,string> = {
  protagonist:'主角', npc:'人物', items:'物品', locations:'地点', organizations:'组织', tasks:'任务', events:'事件',
  economy:'财务', timeline:'时间线', journal:'正式回合', memories:'记忆', contactNpcIds:'联系人', retiredEvents:'已归档事件',
  title:'存档标题', weatherText:'天气', environmentText:'环境', dormantNpcProfiles:'休眠人物档案',
  addressing:'双向称呼', playerToNpc:'主角称呼此人', npcToPlayer:'此人称呼主角',
};
const json = (value: unknown) => JSON.stringify(value,null,2) ?? '';
const typeName = (v: unknown) => v === undefined ? '未设置' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
function Node({path,value,choose}: {path:string[];value:unknown;choose:(path:string[])=>void}) {
  const [open,setOpen] = useState(false);
  const key = path.at(-1)!;
  const title = names[key] ? `${names[key]} (${key})` : key;
  const object = value !== null && typeof value === 'object';
  const kind = typeName(value);
  if (!object) return <li><button title={pointer(path)} onClick={()=>choose(path)}>{title} · {kind}</button> <span>{json(value) || '尚无固定值'}</span></li>;
  const children = Object.entries(value);
  if (path[0] === 'npc' && path.length === 2 && !Object.hasOwn(value,'addressing')) children.push(['addressing',undefined]);
  return <li><details onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>{title} · {kind} ({children.length})</summary>
    {open && <><button onClick={()=>choose(path)}>编辑 {title} JSON</button><ul>{children.map(([name,child])=>
      <Node key={name} path={[...path,name]} value={child} choose={choose}/>)}</ul></>}
  </details></li>;
}

type Props = {
  repository: SaveRepository; saveId: string; onSaved:(result:VariableSnapshot)=>void;
  onDirtyChange:(dirty:boolean)=>void;
};
export function VariableManager({repository, saveId, onSaved, onDirtyChange}:Props) {
  const [base,setBase] = useState<VariableSnapshot>();
  const [working,setWorking] = useState<GameState>();
  const [section,setSection] = useState('protagonist');
  const [editor,setEditor] = useState<{path:string;value:string;initial:string}>();
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(()=>{
    let active = true;
    repository.loadVariableSnapshot(saveId).then(s=>{
      if (active) {setBase(s);setWorking(s.state);setEditor(undefined);}
    }).catch(()=>{if(active)setMessage('读取存档失败。请检查存档后重新读取。');});
    return ()=>{active=false;};
  },[repository,saveId,reload]);
  const changes = useMemo(()=>base && working ? changesBetween(base.state,working) : [],[base,working]);
  const typing = Boolean(editor && editor.value !== editor.initial);
  const dirty = changes.length > 0 || typing;
  useEffect(()=>{onDirtyChange(dirty);return ()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  function choose(path:string[]) {
    if (typing) {setMessage('请先加入或取消正在编辑的值。');return;}
    const value=atPath(working,path);
    const initial=value===undefined && path.at(-1)==='addressing' ? '{}' : json(value);
    setEditor({path:pointer(path),value:initial,initial});setMessage('');
  }
  function stage() {
    if (!working || !editor) return;
    try {
      let value: unknown;
      try {value=JSON.parse(editor.value);} catch {throw new Error('JSON 格式无效。文本值需要双引号。');}
      setWorking(editAtPath(working,editor.path,value));setEditor(undefined);setMessage('');
    } catch(error) {setMessage(error instanceof Error ? error.message : '路径或数值无效。');}
  }
  async function save() {
    if (!working || !base || saving || editor) return;
    setSaving(true);
    try {
      const result=await repository.savePlayerVariables(base,validateVariableEdit(base.state,working));
      setBase(result);setWorking(result.state);setMessage('已保存。下一次生成将读取当前变量。');onSaved(result);
    } catch(error) {setMessage(error instanceof Error ? error.message : '保存失败。修改仍保留在此页。');}
    finally {setSaving(false);}
  }
  const readAgain = <button disabled={dirty || saving} onClick={()=>{setMessage('');setReload(i=>i+1);}}>重新读取</button>;
  if (!base || !working) return <div><p role="status">{message || '正在读取当前存档…'}</p>{readAgain}</div>;
  const current = atPath(working,[section]);
  return <section className="variable-manager">
    <p><strong>{base.state.title}</strong> · 第 {base.state.turnNumber} 回合</p>
    <p>这里编辑当前正式资料。初始同伴的创角原始档案与历史节点保留当时的记录。身份键、账本、回合历史等由专用事务维护。</p>
    <fieldset disabled={saving}>
      <label>变量分区<select value={section} disabled={typing} onChange={e=>{setSection(e.target.value);setEditor(undefined);}}>
        {Object.keys(working).map(key=><option key={key} value={key}>{names[key] ?? key}</option>)}</select></label>
      <ul className="variable-tree"><Node key={section} path={[section]} value={current} choose={choose}/></ul>
      <button onClick={()=>choose([section])}>编辑分区 JSON</button>
      <button disabled={typing} onClick={()=>setEditor({path:pointer([section]),value:'',initial:''})}>按路径修改</button>
      {editor && <div className="variable-editor">
        <label>变量路径<input value={editor.path} onChange={e=>setEditor({...editor,path:e.target.value})}/></label>
        <button disabled={typing} onClick={()=>{try {choose(parsePointer(editor.path));} catch {setMessage('变量路径无效。');}}}>读取路径当前值</button>
        <label>变量值（JSON）<textarea rows={5} value={editor.value} onChange={e=>setEditor({...editor,value:e.target.value})}/></label>
        {editor.path.endsWith('/addressing') && <small>playerToNpc 是主角称呼此人，npcToPlayer 是此人称呼主角。删除某个键可取消该方向的固定称呼。</small>}
        <div><button onClick={stage}>加入待保存修改</button><button onClick={()=>setEditor(undefined)}>取消编辑</button></div>
      </div>}
      {changes.length > 0 && <div aria-label="修改差异"><h4>待保存修改</h4>
        {changes.map(c=><div key={pointer(c.path)}><code>{pointer(c.path)}</code><pre>{json(c.before) || '未设置'} → {json(c.after) || '移除'}</pre></div>)}
        <p>保存后保留本轮行动，清除基于旧变量的未结算正文和候选。撤回或恢复历史节点时，将读取该时点的变量。</p>
      </div>}
      <div><button className="primary" disabled={!changes.length || Boolean(editor)} onClick={()=>void save()}>保存变量修改</button>
        <button disabled={!dirty && !editor} onClick={()=>{setWorking(base.state);setEditor(undefined);setMessage('');}}>放弃修改</button>{readAgain}</div>
    </fieldset>
    <p role="status">{message}</p>
  </section>;
}
