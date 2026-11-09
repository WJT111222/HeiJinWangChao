import { useEffect, useState, useRef, useMemo } from 'react';
import type { Settings } from './model';
import { SettingsSchema } from './model';
import { summaryKinds, summaryNames, defaultSummaryConfig } from '../../domain/memories/configuration';
import type { SummaryKind } from '../../domain/memories/configuration';
import type { GameState } from '../../domain/state';
import { compressionCandidates } from '../../domain/memories/compression';
import { npcSummaryCandidates, npcMemoryIdCounts } from '../../domain/memories/npcMemory';
import { RequestUsage } from '../game/RequestUsage';

export function MemorySummarySettings({ settings, onSave, state, phase, activeKind, notice, onRun, onCancel, onDirtyChange }: {
  settings: Settings; onSave: (settings: Settings) => void; state?: GameState;
  phase?: 'generating' | 'saving'; activeKind?: SummaryKind; notice?: string;
  onRun?: (kind: SummaryKind, npcId?: string) => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(settings.memory.summaries);
  const [immediateWindowSize, setImmediateWindowSize] = useState(settings.memory.immediateWindowSize);
  const immediateTouched = useRef(false);
  const [dirty, setDirty] = useState(false), [message, setMessage] = useState('');
  const touched = useRef(new Set<string>());
  const [npcId, setNpcId] = useState('');
  useEffect(() => { setEditing(previous => {
    const next = structuredClone(settings.memory.summaries);
    for (const kind of summaryKinds) for (const key of Object.keys(previous[kind]) as (keyof typeof previous[SummaryKind])[])
      if (touched.current.has(`${kind}.${key}`)) Object.assign(next[kind], { [key]: previous[kind][key] });
    return next;
  });
    setImmediateWindowSize(previous => immediateTouched.current ? previous : settings.memory.immediateWindowSize);
  }, [settings]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const changeImmediate = (value: number) => {
    immediateTouched.current = true;
    setImmediateWindowSize(value);
    setDirty(true); onDirtyChange?.(true);
  };
  const change = (kind: SummaryKind, patch: Partial<typeof editing[SummaryKind]>) => {
    Object.keys(patch).forEach(key => touched.current.add(`${kind}.${key}`));
    setEditing(value => ({ ...value, [kind]: { ...value[kind], ...patch } })); setDirty(true); onDirtyChange?.(true);
  };
  const npcCounts = useMemo(() => state ? npcMemoryIdCounts(state) : undefined, [state]);
  const npcIds = useMemo(() => state ? Object.keys(state.npc).filter(id => npcSummaryCandidates(state, id, npcCounts).length >= settings.memory.summaries.npc.batchSize) : [], [state, npcCounts, settings.memory.summaries.npc.batchSize]);
  const selectedNpc = npcId || (npcIds.length === 1 ? npcIds[0] : '');
  function save() {
    const summaries = structuredClone(settings.memory.summaries);
    for (const kind of summaryKinds) for (const key of Object.keys(editing[kind]) as (keyof typeof editing[SummaryKind])[])
      if (touched.current.has(`${kind}.${key}`)) Object.assign(summaries[kind], { [key]: editing[kind][key] });
    const parsed = SettingsSchema.safeParse({ ...settings, memory: { ...settings.memory,
      immediateWindowSize: immediateTouched.current ? immediateWindowSize : settings.memory.immediateWindowSize, summaries } });
    if (!parsed.success) { setMessage('即时记忆完整回合数须为1～10000的正整数；总结阈值为1～10000，每批1～100且不能超过阈值；提示词不能为空或超过30000字符。'); return; }
    try {
      onSave(parsed.data);
      if (state) for (const kind of summaryKinds) if (!settings.memory.summaries[kind].automatic && parsed.data.memory.summaries[kind].automatic)
        localStorage.setItem(`heijin.summary.attempt:${state.saveId}:${state.createdAt}:${kind}`, '');
      touched.current.clear(); immediateTouched.current = false;
      setDirty(false); onDirtyChange?.(false);
      setMessage('记忆设置已保存；即时记忆窗口用于下一次正文请求，总结配置用于下一次维护，历史总结不变。');
    } catch { setMessage('设置保存未能完整确认，请重新打开核对；未发起新的总结请求。'); }
  }
  return <section className="memory-summary-settings" aria-label="记忆设置">
    <section className="card" aria-label="即时记忆设置">
      <header className="summary-module-heading"><h4>即时记忆</h4></header>
      <div className="settings-fields">
        <label>即时记忆完整回合数
          <input type="number" min="1" max="10000"
            value={Number.isNaN(immediateWindowSize) ? '' : immediateWindowSize}
            onChange={e => changeImmediate(e.target.valueAsNumber)} />
        </label>
      </div>
    </section>
    <h4>记忆总结</h4>
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
    {dirty && <p role="status">记忆设置尚未保存。</p>}
    <button className="primary" onClick={save}>保存记忆设置</button>
    {phase && <button disabled={phase === 'saving'} onClick={onCancel}>取消当前总结</button>}
    <p role="status">{message || notice}</p>
    {state && <RequestUsage saveId={state.saveId} memoryOnly />}
  </section>;
}
