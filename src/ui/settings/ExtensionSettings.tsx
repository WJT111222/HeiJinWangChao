import { theaterLengths } from '../../domain/theater/record';
import { ModelRouteLabel } from './ModelRouteLabel';
import type { Settings } from './model';
import type { SettingsPage } from './settingsPages';

type Editor = { editing: Settings; change: (value: Settings) => void; navigate: (page: SettingsPage) => void };
export function Segments<T extends string | number>({ label, choices, value, change, disabled }: {
  label: string; choices: ReadonlyArray<readonly [T, string]>; value: T; change: (value: T) => void; disabled?: boolean;
}) {
  return <div className="settings-segments" role="group" aria-label={label}>
    {choices.map(([id, name]) => <button type="button" key={id} disabled={disabled} aria-pressed={value === id} onClick={() => change(id)}>{name}</button>)}
  </div>;
}
export function PhoneSettings({ editing, change, navigate }: Editor) {
  const phone = editing.phone ?? { loanReminderDays: 3 };
  return <>
    <label className="toggle"><input type="checkbox" checked={editing.runtime.phoneChat !== false}
      onChange={event => change({ ...editing, runtime: { ...editing.runtime, phoneChat: event.target.checked } })}/>启用手机聊天（私聊与群聊）</label>
    <p className="field-hint">私聊每条消息调用一次。群消息先调度，再由各发言人独立回复。建群和邀请按受邀人数分别请求。聊天回包格式错误时重试可能产生额外用量。小黑书整批展开未缓存的话题，失败后可手动重试。</p>
    <h4>群聊</h4><div className="settings-form-row"><span>每条群消息最多回复人数<small>默认不限；超出的人记为未读</small></span>
      <Segments label="每条群消息最多回复人数" choices={[[0, '不限'], [2, '2 人'], [3, '3 人'], [5, '5 人']] as const}
        value={phone.groupReplyLimit ?? 0} change={limit => change({ ...editing, phone: { ...phone, groupReplyLimit: limit || undefined } })}/></div>
    <h4>通知</h4><label className="settings-form-row"><span>贷款到期提醒<small>提前几天进入手机通知</small></span>
      <input type="number" min="0" max="30" aria-label="贷款到期提醒天数" value={Number.isNaN(phone.loanReminderDays) ? '' : phone.loanReminderDays}
        onChange={event => change({ ...editing, phone: { ...phone, loanReminderDays: event.target.valueAsNumber } })}/></label>
    <h4>用哪个模型</h4>{([['phone', '私聊回复'], ['phoneGroup', '群聊回复'], ['blackbook', '小黑书刷新']] as const).map(([route, name]) =>
      <div key={route} className="settings-form-row"><span>{name}</span><ModelRouteLabel route={route}/></div>)}
    <p className="field-hint">在 <button className="ai-link" onClick={() => navigate('routing')}>模型分配</button> 里分别修改。</p>
  </>;
}
export function TheaterSettings({ editing, change, navigate }: Editor) {
  const theater = editing.theater ?? { length: 'medium', perspective: 'follow' };
  const set = (patch: Partial<typeof theater>) => change({ ...editing, theater: { ...theater, ...patch } });
  const chars = theater.customChars;
  const validChars = chars !== undefined && Number.isInteger(chars) && chars >= 100 && chars <= 100000;
  return <>
    <p className="field-hint">新建小剧场时带入这里的默认值，每篇创建时都还能改。番外用的提示词在 <button className="ai-link" onClick={() => navigate('promptmgr')}>提示词管理</button> 的「小剧场提示词」里。</p>
    <div className="settings-form-row"><span>默认模型</span><div><ModelRouteLabel route="theater"/> <button className="ai-link" onClick={() => navigate('routing')}>在模型分配里改</button></div></div>
    <div className="settings-form-row"><span>默认篇幅</span><Segments label="默认篇幅" value={theater.length} change={length => set({ length, customChars: validChars ? chars : length === 'custom' ? 3000 : undefined })}
      choices={[...theaterLengths.map(t => [t.id, t.name + ' · 约 ' + t.target.toLocaleString('en-US') + ' 字'] as const), ['custom', '自定义']]}/></div>
    {theater.length === 'custom' && <label className="settings-form-row">目标字数<input type="number" min="100" max="100000"
      value={Number.isNaN(theater.customChars) ? '' : theater.customChars ?? ''} onChange={event => set({ customChars: event.target.valueAsNumber })}/></label>}
    <div className="settings-form-row"><span>默认人称</span><Segments label="默认人称" value={theater.perspective} change={perspective => set({ perspective })}
      choices={[[ 'follow', '跟随主线'], ['first', '第一人称'], ['second', '第二人称'], ['third', '第三人称']]}/></div>
  </>;
}
