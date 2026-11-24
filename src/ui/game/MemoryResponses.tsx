import { useState, useSyncExternalStore } from 'react';
import { summaryNames } from '../../domain/memories/configuration';
import { memoryFailureReasons, memorySteps } from '../../domain/memories/diagnostics';
import type { MemoryDiagnostic } from '../../domain/memories/diagnostics';
import { stageResponses } from '../../services/ai/stageResponses';
import type { StageResponse } from '../../services/ai/stageResponses';
import type { SummaryIssue } from '../../workflows/memorySummaryRecords';

const statuses = { pending: '请求进行中', received: '已收到，待校验保存', validated: '已保存总结', failed: '总结未完成' };

function MemoryResponse({ record, diagnostic, compact }: { record?: StageResponse; diagnostic?: MemoryDiagnostic; compact?: boolean }) {
  const [message, setMessage] = useState('');
  const rawClass = compact ? 'candidate-json' : 'candidate-json story-raw-text';
  const metadata = diagnostic ?? (record && { task: record.memoryTask, status: record.status, model: record.model,
    protocol: record.protocol, requestedAt: record.requestedAt, build: import.meta.env.VITE_FEEDBACK_BUILD,
    httpStatus: record.diagnostics?.httpStatus, transport: record.diagnostics?.transport });
  const technical = metadata ? JSON.stringify(metadata, null, 2) : undefined;
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setMessage('已复制' + label); }
    catch { setMessage('请选中文字复制'); }
  }
  return <>
    {record && <p>{statuses[record.status]} · {record.model ?? '模型未记录'}{record.requestedAt &&
      <> · <time dateTime={record.requestedAt}>{new Date(record.requestedAt).toLocaleString('zh-CN')}</time></>}</p>}
    {diagnostic && <>
      <p>{memorySteps[diagnostic.step]} · {memoryFailureReasons[diagnostic.reason]}（{diagnostic.code}）</p>
      {diagnostic.fieldPath && <p>字段 {diagnostic.fieldPath}</p>}
      {diagnostic.expectedGroups !== undefined &&
        <p>预计分组 {diagnostic.expectedGroups} · 实际分组 {diagnostic.actualGroups ?? '未取得'}</p>}
    </>}
    {technical && <>
      <button type="button" onClick={() => void copy(technical, '技术诊断')}>复制技术诊断</button>
      <details><summary>技术诊断</summary>
        <textarea aria-label="记忆总结技术诊断" className="candidate-json" readOnly spellCheck={false} value={technical} />
      </details>
    </>}
    {record?.text ? <>
      <button type="button" onClick={() => void copy(record.text!, '模型原文')}>复制模型原文</button>
      <textarea aria-label="记忆总结模型原文" className={rawClass} rows={compact ? 5 : undefined} readOnly spellCheck={false} value={record.text} />
    </> : <p>{record?.status === 'pending' ? '正在等待模型原文。' : '本页没有保留此请求的模型原文。'}</p>}
    {record?.nativeReasoning && <details><summary>供应商公开思考</summary>
      <textarea aria-label="记忆总结公开思考" className={rawClass} rows={compact ? 5 : undefined} readOnly spellCheck={false} value={record.nativeReasoning} />
    </details>}
    {record?.truncated && <p className="field-hint">临时展示已达到容量上限。</p>}
    {message && <small role="status">{message}</small>}
  </>;
}

export function MemoryIssueDetails({ issue, saveId }: { issue: SummaryIssue; saveId: string }) {
  const [open, setOpen] = useState(false);
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const record = issue.retryId && issue.diagnostic ? records.find(item => item.stage === 'memory' && item.saveId === saveId &&
    item.memoryRetryId === issue.retryId && item.memoryDiagnostic?.requestedAt === issue.diagnostic?.requestedAt) : undefined;
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>查看总结诊断与模型原文</summary>
    {open && (issue.diagnostic ? <MemoryResponse record={record} diagnostic={issue.diagnostic} compact />
      : <p>此记录没有结构化诊断或模型原文。原错误码为 {issue.code}。</p>)}
  </details>;
}

export function MemoryResponses({ saveId }: { saveId: string }) {
  const [open, setOpen] = useState(false);
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const summaries = records.filter(item => item.stage === 'memory' && item.saveId === saveId);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>记忆总结模型原文{summaries.length > 0 && ' · ' + summaries.length + ' 次'}</summary>
    {open && (summaries.length ? summaries.map(record => <MemoryResponseEntry key={record.id} record={record} />
    ) : <p>本页没有保留记忆总结响应。</p>)}
  </details>;
}

function MemoryResponseEntry({ record }: { record: StageResponse }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{summaryNames[record.memoryTask!]} · {statuses[record.status]}</summary>
    {open && <MemoryResponse record={record} diagnostic={record.memoryDiagnostic} />}
  </details>;
}
