import { useState } from 'react';
import type { AiMessage } from '../../services/ai/protocols';
import type { ModuleRecord } from '../../prompts/composer';
import { inspectedContext, redactInspection } from '../../services/ai/inspection';
import type { contextStatistics } from '../../prompts/statistics';

export function TokenStatistics({
  statistics,
}: {
  statistics?: ReturnType<typeof contextStatistics>;
}) {
  return (
    <dl className="inspection-statistics">
      <dt>上下文字符数</dt>
      <dd>{statistics?.characters ?? '未知'}</dd>
      <dt>估算 Token</dt>
      <dd>{statistics ? `≈ ${statistics.estimatedTokens}` : '未知'}</dd>
      <dt>供应商输入 Token</dt>
      <dd>{statistics?.actual.inputTokens ?? '未提供'}</dd>
      <dt>供应商输出 Token</dt>
      <dd>{statistics?.actual.outputTokens ?? '未提供'}</dd>
      <dt>供应商总 Token</dt>
      <dd>{statistics?.actual.totalTokens ?? '未提供'}</dd>
      <dt>供应商原生思考 Token</dt>
      <dd>{statistics?.actual.reasoningTokens ?? '未提供'}</dd>
      <dt>估算方法</dt>
      <dd>
        Unicode 启发式；ASCII 约 4 字符/Token，其他字符约 1.5 Token/字符。不含协议开销，不是精确
        tokenizer 或真实消耗。
      </dd>
    </dl>
  );
}
export function ContextInspection({
  messages,
  body,
  modules,
  secrets,
}: {
  messages: readonly AiMessage[];
  body?: Record<string, unknown>;
  modules: readonly ModuleRecord[];
  secrets: readonly string[];
}) {
  const [revealed, setRevealed] = useState(false);
  const [view, setView] = useState('messages');
  const safe = redactInspection({ messages, body }, secrets);
  const context = inspectedContext(safe.messages);
  return (
    <>
      <p>消息角色：{safe.messages.map((message) => message.role).join(' → ')}</p>
      <p>
        模块 {modules.length} 个；状态资料结构：
        {context ? Object.keys(context).join('、') : '此请求没有游戏状态容器'}
      </p>
      <p className="notice">
        完整内部内容可能包含后台人物情报。查看不会改变主角认知、游戏存档或普通日志；不包含模型内部思维链。
      </p>
      <button aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
        {revealed ? '隐藏完整内部上下文' : '主动查看完整内部上下文'}
      </button>
      {revealed && (
        <div className="internal-inspection">
          <label>
            内部内容视图
            <select value={view} onChange={(event) => setView(event.target.value)}>
              <option value="messages">组装后消息与角色</option>
              <option value="context">游戏状态与阶段资料</option>
              {body && <option value="body">实际原生请求体（脱敏副本）</option>}
            </select>
          </label>
          <pre tabIndex={0} aria-label="完整内部上下文">
            {JSON.stringify(
              view === 'context'
                ? (context ?? '没有游戏状态容器')
                : view === 'body'
                  ? safe.body
                  : safe.messages,
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </>
  );
}
