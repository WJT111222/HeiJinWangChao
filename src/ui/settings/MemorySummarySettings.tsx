import { useEffect, useState, useRef, useMemo } from 'react';
import type { Settings } from './model';
import { SettingsSchema } from './model';
import { summaryKinds, summaryNames, defaultSummaryConfig } from '../../domain/memories/configuration';
import type { SummaryKind } from '../../domain/memories/configuration';
import type { GameState } from '../../domain/state';
import { compressionCandidates } from '../../domain/memories/compression';
import { npcSummaryCandidates, npcMemoryIdCounts } from '../../domain/memories/npcMemory';
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
  const touched = useRef(new Set<string>());
  const [npcId, setNpcId] = useState('');
  useEffect(() => { setEditing(previous => {
    const next = structuredClone(settings.memory.summaries);
    for (const kind of summaryKinds) for (const key of Object.keys(previous[kind]) as (keyof typeof previous[SummaryKind])[])
      if (touched.current.has(`${kind}.${key}`)) Object.assign(next[kind], { [key]: previous[kind][key] });
    return next;
  }); }, [settings]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const change = (kind: SummaryKind, patch: Partial<typeof editing[SummaryKind]>) => {
    Object.keys(patch).forEach(key => touched.current.add(`${kind}.${key}`));
    setEditing(value => ({ ...value, [kind]: { ...value[kind], ...patch } })); setDirty(true); onDirtyChange?.(true);
  };
  let model = '尚未配置总结模型';
  try { const route = resolveModelRoute(readAiConfig(localStorage), 'memory'); model = redactInspection(`${route.channel.name} / ${route.model}`, browserCredentials()); } catch { /* safe empty state */ }
  const npcCounts = useMemo(() => state ? npcMemoryIdCounts(state) : undefined, [state]);
  const npcIds = useMemo(() => state ? Object.keys(state.npc).filter(id => npcSummaryCandidates(state, id, npcCounts).length >= settings.memory.summaries.npc.batchSize) : [], [state, npcCounts, settings.memory.summaries.npc.batchSize]);
  const selectedNpc = npcId || (npcIds.length === 1 ? npcIds[0] : '');
  function save() {
    const summaries = structuredClone(settings.memory.summaries);
    for (const kind of summaryKinds) for (const key of Object.keys(editing[kind]) as (keyof typeof editing[SummaryKind])[])
      if (touched.current.has(`${kind}.${key}`)) Object.assign(summaries[kind], { [key]: editing[kind][key] });
    const parsed = SettingsSchema.safeParse({ ...settings, memory: { ...settings.memory, summaries } });
    if (!parsed.success) { setMessage('阈值须为1～10000，每批1～100且不超过阈值；内容提示词不能为空或超过30000字符。'); return; }
    try {
      onSave(parsed.data);
      if (state) for (const kind of summaryKinds) if (!settings.memory.summaries[kind].automatic && parsed.data.memory.summaries[kind].automatic)
        localStorage.setItem(`heijin.summary.attempt:${state.saveId}:${state.createdAt}:${kind}`, '');
      touched.current.clear(); setDirty(false); onDirtyChange?.(false); setMessage('三类总结设置已保存，下一次任务使用新配置；历史总结不变。');
    } catch { setMessage('设置保存未能完整确认，请重新打开核对；未发起新的总结请求。'); }
  }
  return <section className="memory-summary-settings" aria-label="记忆总结设置">
    {settings.memory.automaticMaintenance === false && <p>旧版自动维护的关闭状态已延续。旧版默认也是关闭，无法据此判断你是否曾主动关闭；升级时未自动开启收费请求。你可分别开启三种自动总结，已保存的各项选择会继续保留。</p>}
    <p>记忆总结模型：{model}</p><p>自动及立即总结均可能产生第三方 API 费用；后台最多每分钟3次、每小时12次，失败不自动重试。</p>
    {!state && <p>未进入有效存档：可编辑设置，立即总结不可用。</p>}
    {state && <p>当前人生：{state.title}</p>}
    {summaryKinds.map(kind => {
      const config = editing[kind], saved = settings.memory.summaries[kind];
      const count = !state ? 0 : kind === 'npc' ? selectedNpc ? npcSummaryCandidates(state, selectedNpc, npcCounts).length : 0 : compressionCandidates(state, kind).length;
      return <section className="card" key={kind} aria-label={summaryNames[kind]}>
        <header className="summary-module-heading"><h4>{summaryNames[kind]}</h4>
          <button disabled={!state || !onRun || dirty || Boolean(phase) || count < saved.batchSize || (kind === 'npc' && !selectedNpc)}
            onClick={() => onRun?.(kind, kind === 'npc' ? selectedNpc : undefined)}>立即总结 · {summaryNames[kind]}</button></header>
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
