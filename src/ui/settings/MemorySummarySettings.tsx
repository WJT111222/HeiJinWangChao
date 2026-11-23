import { useEffect, useState, useRef, useMemo } from 'react';
import type { Settings } from './model';
import { SettingsSchema, settingsKey } from './model';
import { summaryKinds, summaryNames, defaultSummaryConfig } from '../../domain/memories/configuration';
import type { SummaryKind } from '../../domain/memories/configuration';
import type { GameState } from '../../domain/state';
import { publicShortMemories } from '../../domain/memories/publicMemory';
import { compressionCandidates } from '../../domain/memories/compression';
import { npcSummaryCandidates, npcMemoryIdCounts, validNpcSummary } from '../../domain/memories/npcMemory';
import type { SummaryIssue } from '../../workflows/memorySummaryRecords';
import { RequestUsage } from '../game/RequestUsage';

export function MemorySummarySettings({ settings, onSave, state, phase, activity, failures = [], paused, busy, notice, onRun, onCancel, onDirtyChange }: {
  settings: Settings; onSave: (settings: Settings, base?: Settings) => void; state?: GameState;
  phase?: 'generating' | 'saving'; activity?: { kind: SummaryKind; npcId?: string };
  failures?: SummaryIssue[]; paused?: boolean; busy?: boolean; notice?: string;
  onRun?: (kind: SummaryKind, npcId?: string, retryId?: string) => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void;
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
  const shortTotal = useMemo(() => state ? new Set([...publicShortMemories(state), ...state.memories.short].map(entry => entry.id)).size : 0, [state]);
  const npcCounts = useMemo(() => state ? npcMemoryIdCounts(state) : undefined, [state]);
  const people = useMemo(() => Object.values(state?.npc ?? {}).filter(person => person.memories.length || state?.memories.npcSummaries[person.id]?.length)
    .map(person => ({ person, eligible: npcSummaryCandidates(state!, person.id, npcCounts).length })), [state, npcCounts]);
  const readyPeople = people.filter(item => item.eligible >= settings.memory.summaries.npc.batchSize ||
    failures.some(issue => issue.kind === 'npc' && issue.npcId === item.person.id));
  const selectedNpc = people.some(item => item.person.id === npcId) ? npcId : readyPeople.length === 1 ? readyPeople[0].person.id
    : people.length === 1 ? people[0].person.id : '';
  const shownPeople = selectedNpc ? people.filter(item => item.person.id === selectedNpc) : people;
  function runSummary(kind: SummaryKind, retryId?: string) {
    const target = kind === 'npc' ? selectedNpc : undefined;
    if (target) setNpcId(target);
    onRun?.(kind, target, retryId);
  }
  function save() {
    try {
      const raw = localStorage.getItem(settingsKey);
      const latest = raw === null ? settings : SettingsSchema.parse(JSON.parse(raw));
      const summaries = structuredClone(latest.memory.summaries);
      for (const kind of summaryKinds) for (const key of Object.keys(editing[kind]) as (keyof typeof editing[SummaryKind])[])
        if (touched.current.has(`${kind}.${key}`)) Object.assign(summaries[kind], { [key]: editing[kind][key] });
      const parsed = SettingsSchema.safeParse({ ...latest, memory: { ...latest.memory,
        immediateWindowSize: immediateTouched.current ? immediateWindowSize : latest.memory.immediateWindowSize, summaries } });
      if (!parsed.success) { setMessage('即时记忆完整回合数须为1～10000的正整数；总结阈值为1～10000，每批1～100且不能超过阈值；提示词不能为空或超过30000字符。'); return; }
      onSave(parsed.data, latest);
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
      const total = kind === 'npc' ? shownPeople.reduce((sum, { person }) => sum + person.memories.length, 0) : kind === 'short' ? shortTotal : state?.memories[kind].length ?? 0;
      const count = kind === 'npc' ? shownPeople.reduce((sum, item) => sum + item.eligible, 0) : state ? compressionCandidates(state, kind).length : 0;
      const issues = failures.filter(item => item.kind === kind && (kind !== 'npc' || item.legacy || !selectedNpc || !item.npcId || item.npcId === selectedNpc));
      const pending = issues.find(item => item.pending);
      const inProgress = activity?.kind === kind && (kind !== 'npc' || !selectedNpc || activity.npcId === selectedNpc);
      const ready = kind === 'npc' ? shownPeople.some(item => item.eligible >= saved.threshold) : count > saved.threshold;
      const oldSummary = kind === 'npc' && selectedNpc && state &&
        state.memories.npcSummaries[selectedNpc]?.some(entry => !validNpcSummary(state, selectedNpc, entry));
      const status = inProgress ? phase === 'saving' ? '正在保存总结' : '正在总结'
        : !saved.automatic ? '已暂停自动总结' : paused ? '已暂停，提交新行动后恢复检查'
          : issues.length ? busy && issues.every(issue => issue.pending && issue.code === 'MEMORY_PREVIOUS') ? '其他标签正在处理' : '失败待处理'
            : ready ? '已达阈值，等待调度' : '等待达到阈值';
      const canRetry = pending?.retryId && issues.every(item => !item.pending || item === pending || (!pending.legacy && item.legacy && (!item.npcId || item.npcId === selectedNpc))) &&
        (!pending.npcId || pending.npcId === selectedNpc) && (!pending.identityKey || state?.npc[selectedNpc]?.identityKey === pending.identityKey);
      return <section className="card" key={kind} aria-label={summaryNames[kind]}>
        <header className="summary-module-heading"><h4>{summaryNames[kind]}</h4>
          {pending ? pending.retryId && <button disabled={!state || !onRun || dirty || Boolean(phase) || busy || !canRetry || !count || (kind === 'npc' && !selectedNpc)}
            onClick={() => runSummary(kind, pending.retryId)}>{pending.legacy ? '核对原批并重试（可能计费）' : '重新生成此批（可能计费）'}</button>
            : <button disabled={!state || !onRun || dirty || Boolean(phase) || count < saved.batchSize || (kind === 'npc' && !selectedNpc)}
              onClick={() => runSummary(kind)}>立即总结 · {summaryNames[kind]}</button>}</header>
        <label className="toggle"><input type="checkbox" checked={config.automatic} onChange={e => change(kind, { automatic: e.target.checked })} />自动总结 {summaryNames[kind]}</label>
        <div className="settings-fields">
          <label>触发阈值 · {summaryNames[kind]}<input type="number" min="1" max="10000" value={Number.isNaN(config.threshold) ? '' : config.threshold} onChange={e => change(kind, { threshold: e.target.valueAsNumber })} /></label>
          <label>每次总结条数 · {summaryNames[kind]}<input type="number" min="1" max="100" value={Number.isNaN(config.batchSize) ? '' : config.batchSize} onChange={e => change(kind, { batchSize: e.target.valueAsNumber })} /></label>
        </div>
        {kind === 'npc' && <>
          <label>总结目标 NPC<select value={selectedNpc} onChange={e => setNpcId(e.target.value)}><option value="">请选择人物</option>{people.map(({ person }) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        </>}
        {state && <>
          <p>本层共 {total} 条 · 当前合格未覆盖：{count} 条{!pending && (kind !== 'npc' || selectedNpc) && count < saved.batchSize ? `；不足${saved.batchSize}条，不调用模型。` : ''}</p>
          <p>自动条件：{kind === 'npc' ? '单个人物达到' : '超过'} {saved.threshold} 条 · 每批 {saved.batchSize} 条</p>
          <p role="status">{status}</p>
          {oldSummary && <p>此人物有来源无法核对的旧总结，已保留记录并暂停自动整理。</p>}
          {issues.map((issue, index) => <p key={`${issue.kind}-${issue.npcId}-${issue.code}-${index}`}>
            {kind === 'npc' && issue.npcId && <>{state.npc[issue.npcId]?.name ?? '原人物'} · </>}
            {issue.message}{issue.pending && issue.code !== 'MEMORY_PREVIOUS' && ' 此请求可能已计费，等待你确认处理。'}
          </p>)}
        </>}
        <label>完整内容提示词 · {summaryNames[kind]}<textarea rows={12} value={config.prompt} onChange={e => change(kind, { prompt: e.target.value })} /></label>
        <button onClick={() => change(kind, { prompt: defaultSummaryConfig(kind).prompt })}>恢复默认提示词 · {summaryNames[kind]}</button>
      </section>;
    })}
    <div className="memory-save-bar">{dirty && <p role="status">记忆设置尚未保存。</p>}
    <button className="primary" onClick={save}>保存记忆设置</button>
    {phase && <button disabled={phase === 'saving'} onClick={onCancel}>取消当前总结</button>}
    {(message || notice) && <p role="status">{message || notice}</p>}
    </div>{state && <RequestUsage saveId={state.saveId} memoryOnly />}
  </section>;
}
