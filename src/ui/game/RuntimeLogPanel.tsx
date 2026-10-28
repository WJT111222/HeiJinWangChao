import { useEffect, useRef, useState } from 'react';
import type { RuntimeLogEntry } from './runtimeLog';
import { runtimeStageNames } from './runtimeLog';
import { domainRuleNames } from '../../executors/variableText/aggregateDiagnostics';

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
  onClear,
}: {
  entries: readonly RuntimeLogEntry[];
  onClear: () => void;
}) {
  const [copyError, setCopyError] = useState(false);
  const logElement = useRef<HTMLDetailsElement>(null);
  const errorCount = entries.filter((entry) => entry.kind === 'failed').length;
  const latestError = [...entries].reverse().find((entry) => entry.kind === 'failed');
  const latestErrorId = latestError?.id;
  // Only new failures reopen the log; the player can still collapse it manually.
  useEffect(() => {
    if (latestErrorId !== undefined && logElement.current) logElement.current.open = true;
  }, [latestErrorId]);
  async function copy() {
    try {
      // Entries are derived only from fixed messages and sanitized error metadata.
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <details ref={logElement} className="runtime-log" data-testid="runtime-log">
      <summary>
        <span>运行日志 · {entries.length} 条</span>
        {errorCount > 0 && <strong className="runtime-log-error-count">错误 {errorCount} 条{latestError?.code ? ` · ${latestError.code}` : ''}</strong>}
      </summary>
      <div className="runtime-log-content">
        <p className="field-hint">仅显示本次页面会话的安全诊断；不保存原始模型响应、请求正文、密钥或 NPC 私密数据。刷新即清空。</p>
        <div className="runtime-log-actions">
          <button type="button" disabled={!entries.length} onClick={() => void copy()}>复制安全日志</button>
          <button type="button" disabled={!entries.length} onClick={onClear}>清空日志</button>
          {copyError && <span role="status">复制失败，请检查浏览器剪贴板权限。</span>}
        </div>
        {entries.length ? (
          <ol aria-label="运行日志条目">
            {[...entries].reverse().map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                <strong>{runtimeStageNames[entry.stage]}</strong>
                <span className={entry.kind === 'failed' ? 'runtime-log-failure' : 'muted'}>
                  {entry.kind === 'started' ? '开始' : entry.kind === 'completed' ? '完成' : entry.kind === 'cancelled' ? '取消' : '错误'}
                </span>
                <p>{entry.message}</p>
                {entry.code && <small>错误码：{entry.code}</small>}
                {entry.httpStatus && <small>HTTP 状态：{entry.httpStatus}</small>}
                {entry.fieldPath && <small>字段：{entry.fieldPath}</small>}
                {entry.commandIndex && <small>命令序号：第 {entry.commandIndex} 条</small>}
                {entry.commandType && <small>命令类型：{entry.commandType}</small>}
                {entry.valuePath && <small>变量路径：{entry.valuePath}（实体 ID 已隐藏）</small>}
                {entry.expectedType && <small>期望类型：{entry.expectedType}</small>}
                {entry.actualType && <small>实际类型：{entry.actualType}</small>}
                {entry.validationRule && <small>校验规则：{ruleNames[entry.validationRule]}</small>}
                {entry.domainRule && <small>整批校验原因：{domainRuleNames[entry.domainRule]}</small>}
                {entry.relatedCommandIndices?.length ? <small>相关命令：{entry.relatedCommandIndices.map((index) => `第${index}条`).join('、')}（整批失败，无法确定唯一出错命令）</small> : null}
              </li>
            ))}
          </ol>
        ) : <p className="muted">本次页面尚无运行事件。</p>}
      </div>
    </details>
  );
}
