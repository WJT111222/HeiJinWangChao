import { domainRuleNames } from '../../executors/variableText/aggregateDiagnostics';
import type { RuntimeLogEntry } from './runtimeLog';

const ruleNames: Record<string, string> = {
  invalid_type: '类型不匹配',
  required_field: '必填字段缺失',
  schema_constraint: '结构约束不满足',
  value_constraint: '值约束不满足',
  reserved_field: '使用了保留字段',
  path_identity: '路径与实体身份不一致',
  domain_schema: '领域状态校验失败',
};

export function RuntimeLogPanel({ entries, onCopyOne }: { entries: RuntimeLogEntry[]; onCopyOne: (entry: RuntimeLogEntry) => Promise<boolean> }) {
  const [copyFeedback, setCopyFeedback] = useState<{ id: number; ok: boolean } | null>(null);
  const copyOne = async (entry: RuntimeLogEntry) => {
    const ok = await onCopyOne(entry);
    setCopyFeedback({ id: entry.id, ok });
  };
  return (
    <details>
      <summary>运行日志（仅本次页面，不写入存档）</summary>
      <div className="runtime-log">
        {entries.length ? (
          <ol>
            {entries.map((entry) => (
              <li key={entry.id} className={entry.kind === 'failed' ? 'runtime-log-failed' : ''}>
                <div className="runtime-log-header">
                  <span>{entry.timestamp}</span>
                  <span>{entry.stage}</span>
                  {entry.kind === 'failed' && <span className="runtime-log-failure">错误</span>}
                  <button type="button" onClick={() => void copyOne(entry)}>复制此条</button>
                </div>
                {copyFeedback?.id === entry.id && (
                  <small role="status">{copyFeedback.ok ? '已复制此条错误日志' : '复制失败，请检查浏览器剪贴板权限'}</small>
                )}
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
                {entry.domainRule && <small>整批校验原因：{domainRuleNames[entry.domainRule]}{entry.relatedNpcId ? `（NPC：${entry.relatedNpcId}）` : ''}</small>}
                {entry.relatedNpcId && !entry.domainRule && <small>相关 NPC：{entry.relatedNpcId}</small>}
                {entry.relatedCommandIndices?.length ? <small>相关命令：{entry.relatedCommandIndices.map((index) => `第${index}条`).join('、')}（整批失败，无法确定唯一出错命令）</small> : null}
              </li>
            ))}
          </ol>
        ) : <p className="muted">本次页面尚无错误。</p>}
      </div>
    </details>
  );
}
