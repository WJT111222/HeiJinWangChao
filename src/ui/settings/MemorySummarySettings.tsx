import { useEffect, useState } from 'react';
import type { Settings } from './model';
import { SettingsSchema } from './model';
import { summaryKinds, summaryNames, defaultSummaryConfig } from '../../domain/memories/configuration';
import type { SummaryKind } from '../../domain/memories/configuration';
import type { GameState } from '../../domain/state';
import { compressionCandidates } from '../../domain/memories/compression';
import { npcSummaryCandidates } from '../../domain/memories/npcMemory';
import { readAiConfig } from '../../services/ai/configuration';
import { resolveModelRoute } from '../../services/ai/snapshot';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { RequestUsage } from '../game/RequestUsage';

export function MemorySummarySettings({ settings, onSave, state, phase, activeKind, notice, onRun, onCancel, onDirtyChange }: {
  settings: Settings; onSave: (settings: Settings) => void; state?: GameState;
  phase?: 'generating' | 'saving'; activeKind?: SummaryKind; notice?: string;
  onRun?: (kind: SummaryKind, npcId?: string) => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(settings.memory.summaries);
  const [dirty, setDirty] = useState(false), [message, setMessage] = useState('');
  const [npcId, setNpcId] = useState('');
  useEffect(() => { if (!dirty) setEditing(settings.memory.summaries); }, [settings, dirty]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const change = (kind: SummaryKind, patch: Partial<typeof editing[SummaryKind]>) => {
    setEditing(value => ({ ...value, [kind]: { ...value[kind], ...patch } })); setDirty(true); onDirtyChange?.(true);
  };
  let model = '尚未配置总结模型';
  try { const route = resolveModelRoute(readAiConfig(localStorage), 'memory'); model = redactInspection(`${route.channel.name} / ${route.model}`, browserCredentials()); } catch { /* safe empty state */ }
  const npcIds = state ? Object.keys(state.npc).filter(id => npcSummaryCandidates(state, id).length >= settings.memory.summaries.npc.batchSize) : [];
  const selectedNpc = npcId || (npcIds.length === 1 ? npcIds[0] : '');
  function save() {
    const parsed = SettingsSchema.safeParse({ ...settings, memory: { ...settings.memory, summaries: editing } });
    if (!parsed.success) { setMessage('阈值须为1～10000，每批1～100且不超过阈值；内容提示词不能为空或超过30000字符。'); return; }
    try {
      onSave(parsed.data);
      if (state) for (const kind of summaryKinds) if (!settings.memory.summaries[kind].enabled && editing[kind].enabled)
        localStorage.setItem(`heijin.summary.attempt:${state.saveId}:${state.createdAt}:${kind}`, '');
      setDirty(false); onDirtyChange?.(false); setMessage('三类总结设置已保存，下一次任务使用新配置；历史总结不变。');
    } catch { setMessage('设置保存失败，原配置未覆盖。'); }
  }
  return <section className="memory-summary-settings" aria-label="记忆总结设置">
    <p>记忆总结模型：{model}</p><p>自动及立即总结均可能产生第三方 API 费用；后台最多每分钟3次、每小时12次，失败不自动重试。</p>
    {!state && <p>未进入有效存档：可编辑设置，立即总结不可用。</p>}
    {summaryKinds.map(kind => {
      const config = editing[kind], saved = settings.memory.summaries[kind];
      const count = !state ? 0 : kind === 'npc' ? selectedNpc ? npcSummaryCandidates(state, selectedNpc).length : 0 : compressionCandidates(state, kind).length;
      return <section className="card" key={kind} aria-label={summaryNames[kind]}>
        <header className="summary-module-heading"><h4>{summaryNames[kind]}</h4>
          <button disabled={!state || !onRun || !saved.enabled || dirty || Boolean(phase) || count < saved.batchSize || (kind === 'npc' && !selectedNpc)}
            onClick={() => onRun?.(kind, kind === 'npc' ? selectedNpc : undefined)}>立即总结 · {summaryNames[kind]}</button></header>
        <label className="toggle"><input type="checkbox" checked={config.enabled} onChange={e => change(kind, { enabled: e.target.checked })} />启用 {summaryNames[kind]}</label>
        <label className="toggle"><input type="checkbox" checked={config.automatic} onChange={e => change(kind, { automatic: e.target.checked })} />自动总结 {summaryNames[kind]}</label>
        <div className="settings-fields">
          <label>触发阈值 · {summaryNames[kind]}<input type="number" min="1" max="10000" value={Number.isNaN(config.threshold) ? '' : config.threshold} onChange={e => change(kind, { threshold: e.target.valueAsNumber })} /></label>
          <label>每次总结条数 · {summaryNames[kind]}<input type="number" min="1" max="100" value={Number.isNaN(config.batchSize) ? '' : config.batchSize} onChange={e => change(kind, { batchSize: e.target.valueAsNumber })} /></label>
        </div>
        {kind === 'npc' && <>
          <label>总结目标 NPC<select value={selectedNpc} onChange={e => setNpcId(e.target.value)}><option value="">请选择人物</option>{npcIds.map(id => <option key={id} value={id}>{state!.npc[id].name}</option>)}</select></label>
          <p>默认20条触发、整理15条，保留最近5条活跃未覆盖记忆；当前配置预留约 {Math.max(0, config.threshold - config.batchSize)} 条。NPC总结不再转长期。</p>
        </>}
        {state && <p>当前合格未覆盖：{count} 条；一次必须完整处理 {saved.batchSize} 条。{count < saved.batchSize ? `不足${saved.batchSize}条，不调用模型。` : ''}</p>}
        <label>完整内容提示词 · {summaryNames[kind]}<textarea rows={12} value={config.prompt} onChange={e => change(kind, { prompt: e.target.value })} /></label>
        <button onClick={() => change(kind, { prompt: defaultSummaryConfig(kind).prompt })}>恢复默认提示词 · {summaryNames[kind]}</button>
        {activeKind === kind && <p role="status">{phase === 'saving' ? '正在保存总结…' : '正在生成总结…'}</p>}
      </section>;
    })}
    {dirty && <p role="status">记忆总结设置尚未保存。</p>}
    <button className="primary" onClick={save}>保存记忆总结设置</button>
    {phase && <button disabled={phase === 'saving'} onClick={onCancel}>取消当前总结</button>}
    <p role="status">{message || notice}</p>
    {state && <RequestUsage saveId={state.saveId} memoryOnly />}
  </section>;
}
