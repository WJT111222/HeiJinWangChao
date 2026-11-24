import { summaryNames } from '../../domain/memories/configuration';
import { memorySteps } from '../../domain/memories/diagnostics';
import { ErrorFeedbackDialog } from '../feedback/FeedbackForms';
import { storyRuleNames } from '../../domain/storyDiagnostics';
import { variableStepNames } from '../../services/ai/errors';
import { useEffect, useRef, useState } from 'react';
import type { RuntimeLogEntry } from './runtimeLog';
import { runtimeStageNames } from './runtimeLog';
import { domainRuleNames } from '../../executors/variableText/aggregateDiagnostics';
import { worldRuleNames } from '../../services/validation/worldDiagnostics';
import type { TurnDraft } from '../../domain/drafts';
import { SavedFailureSummary, currentDraftFailures } from './SavedFailureSummary';

const ruleNames = {
  invalid_type: '字段值类型不符合要求',
  required_field: '必填字段缺失',
  schema_constraint: '值未通过 Schema 约束',
  value_constraint: '字段值不满足格式或范围约束',
  reserved_field: '提交了由程序维护的保留字段',
  path_identity: '实体 ID 必须由命令路径绑定',
  domain_schema: '领域 Schema 校验失败，无法安全细分字段',
} as const;

export function RuntimeLogPanel({
  entries,
  feedbackLogs,
  onClear,
  draft,
  recovery,
}: {
  entries: readonly RuntimeLogEntry[];
  feedbackLogs?: readonly RuntimeLogEntry[];
  onClear: () => void;
  draft?: TurnDraft;
  recovery?: string;
}) {
  const [copyFeedback, setCopyFeedback] = useState<{ id: number; ok: boolean } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const logElement = useRef<HTMLDetailsElement>(null);
  const errors = entries.filter((entry) => entry.kind === 'failed');
  const latestError = errors[errors.length - 1];
  const latestErrorId = latestError?.id;
  const cancelled = entries.filter(entry => entry.kind === 'cancelled').at(-1);
  const failures = currentDraftFailures(draft);
  // Only new failures reopen the log; the player can still collapse it manually.
  useEffect(() => {
    if (latestErrorId !== undefined && logElement.current) logElement.current.open = true;
  }, [latestErrorId]);
  async function copyOne(entry: RuntimeLogEntry) {
    try {
      // Copy exactly one already-sanitized failed event; never include earlier workflow events.
      await navigator.clipboard.writeText(JSON.stringify(entry.memory ?? entry, null, 2));
      setCopyFeedback({ id: entry.id, ok: true });
    } catch {
      setCopyFeedback({ id: entry.id, ok: false });
    }
  }
  return (
    <><SavedFailureSummary draft={draft} entries={entries} recovery={recovery} />
    <details ref={logElement} className="runtime-log" data-testid="runtime-log">
      <summary>
        <span>运行日志 · 错误 {errors.length} 条</span>
        {latestError?.code && <strong className="runtime-log-error-count">最近错误 · {latestError.code}</strong>}
      </summary>
      <div className="runtime-log-content">
        <p className="field-hint">显示当前回合的本页临时日志及当前存档的记忆总结错误；已恢复的回合失败不再计为当前错误。每条可单独复制安全诊断，不含原始模型响应、请求正文或密钥。刷新即清空。</p>
        {cancelled && <p className="field-hint">最近操作已取消，未计入生成失败。</p>}
        <div className="runtime-log-actions">
          {feedbackLogs && <button type="button" disabled={!feedbackLogs.some(entry => entry.kind === 'failed')}
            onClick={() => setFeedbackOpen(true)}>上报错误</button>}
          <button type="button" disabled={!entries.length} onClick={onClear}>清空日志</button>
        </div>
        {errors.length ? (
          <ol aria-label="错误日志条目">
            {[...errors].reverse().map((entry) => (
              <li key={entry.id}>
                <div className="runtime-log-entry-header">
                  <div>
                    <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                    <strong>{runtimeStageNames[entry.stage]}{entry.memory && ' · ' + summaryNames[entry.memory.task]}</strong>
                    <span className="runtime-log-failure">错误</span>
                  </div>
                  <button type="button" onClick={() => void copyOne(entry)}>复制此条</button>
                </div>
                {copyFeedback?.id === entry.id && (
                  <small role="status">{copyFeedback.ok ? '已复制此条错误日志' : '复制失败，请检查浏览器剪贴板权限'}</small>
                )}
                <p>{entry.message}</p>
                {entry.scope && <small>本页存档标识：{entry.scope.saveRef} · 本页回合标识：{entry.scope.turnRef}（匿名关联标识）</small>}
                {entry.memory && <small>步骤：{memorySteps[entry.memory.step]}{entry.memory.httpStatus && ` · HTTP ${entry.memory.httpStatus}`}</small>}
                {entry.code && <small>错误码：{entry.code}</small>}
                {entry.storyRule && <small>正文失败类型：{entry.storyRule} · {storyRuleNames[entry.storyRule]}</small>}
                {entry.httpStatus && <small>HTTP 状态：{entry.httpStatus}</small>}
                {entry.fieldPath && <small>字段：{entry.fieldPath}</small>}
                {entry.commandIndex && <small>命令序号：第 {entry.commandIndex} 条</small>}
                {entry.commandType && <small>命令类型：{entry.commandType}</small>}
                {entry.valuePath && <small>变量路径：{entry.valuePath}（实体 ID 已隐藏）</small>}
                {entry.expectedType && <small>期望类型：{entry.expectedType}</small>}
                {entry.actualType && <small>实际类型：{entry.actualType}</small>}
                {entry.validationRule && <small>校验规则：{ruleNames[entry.validationRule]}</small>}
                {entry.domainRule && <small>{entry.commandIndex ? '命令' : '整批'}校验原因：{domainRuleNames[entry.domainRule]}{entry.relatedNpcId ? `（NPC：${entry.relatedNpcId}）` : ''}</small>}
                {entry.relatedNpcId && !entry.domainRule && <small>相关 NPC：{entry.relatedNpcId}</small>}
                {entry.variableStep && <small>处理步骤：{variableStepNames[entry.variableStep]}</small>}
                {entry.worldRule && <small>世界校验：{entry.worldRule} · {worldRuleNames[entry.worldRule]}</small>}
                {entry.relatedCommandIndices?.length ? <small>相关命令：{entry.relatedCommandIndices.map((index) => `第${index}条`).join('、')}（整批失败，无法确定唯一出错命令）</small> : null}
              </li>
            ))}
          </ol>
        ) : <p className="muted">{failures.length ? '本页暂无该次失败的详细运行日志；请查看上方持久失败摘要。' : '本页暂无错误。'}</p>}
      </div>
    </details>
    {feedbackOpen && feedbackLogs && <ErrorFeedbackDialog entries={feedbackLogs} onClose={() => setFeedbackOpen(false)} />}
    </>
  );
}
