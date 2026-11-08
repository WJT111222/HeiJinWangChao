import { useState } from 'react';
import type { AiMessage } from '../../services/ai/protocols';
import type { ModuleRecord } from '../../prompts/composer';
import { inspectedContext, redactInspection } from '../../services/ai/inspection';
import type { contextStatistics } from '../../prompts/statistics';
import { inspectBudget, unknownWindowWarning } from '../../prompts/budgetInspection';

export function TokenStatistics({
  statistics,
}: {
  statistics?: ReturnType<typeof contextStatistics>;
}) {
  return (
    <dl className="inspection-statistics">
      <dt>上下文字符数</dt>
      <dd>{statistics?.characters ?? '未知'}</dd>
      <dt>内容 UTF-8 字节 / 消息数</dt>
      <dd>{statistics ? `${statistics.contentBytes} / ${statistics.messageCount}` : '未知'}</dd>
      <dt>JSON 消息数组 UTF-8 字节（非完整 HTTP 请求体）</dt>
      <dd>{statistics?.serializedMessagesBytes ?? '未知'}</dd>
      <dt>估算输入 Token</dt>
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
        tokenizer 或真实消耗。估算保留消息间人工换行 {statistics?.estimateSeparatorCharacters ?? '未知'} 字符；字符与字节总量不含这些换行。
      </dd>
    </dl>
  );
}
export function ContextInspection({
  messages,
  body,
  modules,
  secrets,
  budget,
}: {
  messages: readonly AiMessage[];
  body?: Record<string, unknown>;
  modules: readonly ModuleRecord[];
  secrets: readonly string[];
  budget?: ReturnType<typeof inspectBudget>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [view, setView] = useState('messages');
  const [allDuplicates, setAllDuplicates] = useState(false);
  const safe = redactInspection({ messages, body }, secrets);
  const context = inspectedContext(safe.messages);
  const measured = budget ?? inspectBudget(messages);
  return (
    <>
      <p className="notice">{unknownWindowWarning} 此提醒不阻断游戏，不自动裁剪数据或切换模型。</p>
      <details>
        <summary>展开数据分类、召回预算与重复诊断</summary>
        {measured.parseWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
        <p>NPC {measured.counts.npc}；正式 NPC 记忆 {measured.counts.npcMemories}；近期完整 Story {measured.counts.recent}；旧史召回 {measured.counts.recalled}。零召回不表示零 NPC 记忆。</p>
        <ul>{measured.categories.map(row => <li key={row.id}>{row.label}：{row.characters} 字符 / {row.bytes} UTF-8 字节 / ≈ {row.estimatedTokens} Token / {(row.proportion * 100).toFixed(1)}%</li>)}</ul>
        <p>以上来自最终消息的序列化值；键名、标点、容器及空白单列。字符差额 {measured.reconciliation.characters}，字节差额 {measured.reconciliation.bytes}；分组取整与消息间人工换行造成 Token 估算差额 {measured.reconciliation.estimatedTokenRounding}。重复表示全部计入，供应商协议开销未知。</p>
        <p>召回预算只影响旧journal原文，不影响完整正式世界状态。</p>
        {measured.recall && <>
          <p>强相关 {measured.recall.strong} / 辅助 {measured.recall.auxiliary} / 截断记录 {measured.recall.truncated}；召回正文 {measured.recall.narrativeCharacters} Unicode 字符，元数据与摘要 {measured.recall.metadataCharacters} 序列化 Unicode 字符（实际消息范围减去 narrativeExcerpt 序列化值，仍含字段名与标点）。原始预算诊断的字符与截取范围按 UTF-16，见下方。</p>
          <pre aria-label="召回预算诊断">{JSON.stringify(measured.recall.diagnostics, null, 2)}</pre>
        </>}
        <p>可验证重复组 {measured.duplicates.length}；额外体量表示首处之后仍传输的整个表示，可能包含不同字段。嵌套诊断会重叠，不能相加当作可节省总量；不判断语义相似，不删除。</p>
        <p>后续重复表示的消息范围并集：{measured.repeatedRepresentation.characters} 字符 / {measured.repeatedRepresentation.bytes} UTF-8 字节。此并集排除嵌套双计，仍不是可删除或可节省体量。</p>
        {measured.duplicates.length > 50 && <button onClick={() => setAllDuplicates(!allDuplicates)}>{allDuplicates ? '仅显示前50组重复' : '显示全部重复组'}</button>}
        <ul>{(allDuplicates ? measured.duplicates : measured.duplicates.slice(0, 50)).map((item, index) => <li key={index}>{item.identity}：{item.occurrences} 次；额外表示约 {item.extraCharacters} 字符 / {item.extraBytes} 字节；{item.exactContent ? '序列化内容完全相同' : '同一 ID 的不同表示，不能视为全文相同'}。{item.compatibility}<br />{item.locations.join(' → ')}</li>)}</ul>
      </details>
      <p>消息角色：{safe.messages.map((message) => message.role).join(' → ')}</p>
      <p>
        模块 {modules.length} 个；状态资料结构：
        {context ? Object.keys(context).join('、') : '此请求没有游戏状态容器'}
      </p>
      <p>模块版本与字符来自组装器记录；实际供应商协议可能合并 system 消息，数据分类基于发送边界消息，不假设每个模块仍为独立消息。</p>
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
