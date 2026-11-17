import type { TurnDraft } from '../../domain/drafts';
import { storyRuleNames } from '../../domain/storyDiagnostics';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stageResponses, selectStageResponse } from '../../services/ai/stageResponses';
import type { StageResponse } from '../../services/ai/stageResponses';
import { worldRuleNames } from '../../services/validation/worldDiagnostics';
import type { AiStage } from '../../services/ai/configuration';

export function StageResponseContent({ record, label }: { record?: StageResponse; label: string }) {
  const story = record?.stage === 'story';
  const text = story ? record.displayText ?? (record.nativeReasoning ?? '') + (record.text ?? '') : record?.text;
  const order = record?.displayOrder ?? 'unknown';
  if (record && !story) return <ObservedResponse key={record.id} record={record} label={label} />;
  return <>
    {!text ? <p>{record?.status === 'pending' ? '请求尚未返回完整内容。' : '本页面没有可恢复的模型原文；已保存的候选不是模型原文，刷新后请查看规范化记录。'}</p>
      : story ? <textarea className="candidate-json story-raw-text" aria-label={`${label}模型完整原文`} readOnly spellCheck={false} value={text} />
        : <pre className="candidate-json" tabIndex={0} aria-label={`${label}模型完整原文`}>{text}</pre>}
    {record?.truncated && <p role="note">临时展示已达到容量上限，后续内容未保留；不影响正式解析输入。</p>}
    {story && text && order !== 'events' && <p className="field-hint">{order === 'unknown'
      ? '合并显示公开返回内容；非流式响应或缺少事件记录时，字段间真实返回先后不可知。'
      : '按收到的事件顺序显示；同一事件内的字段及内容块按响应排列，不代表生成先后。'}</p>}
  </>;
}

function ObservedResponse({ record, label }: { record: StageResponse; label: string }) {
  const [view, setView] = useState('content');
  const diagnostic = record.diagnostics;
  const box = useRef<HTMLTextAreaElement>(null), following = useRef(true);
  useLayoutEffect(() => {
    // Follow only at the bottom and without a selection; copying/reading older text is stable.
    const element = box.current;
    if (record.status === 'pending' && following.current && element && element.selectionStart === element.selectionEnd)
      element.scrollTop = element.scrollHeight;
  }, [record.text, record.nativeReasoning, record.status]);
  const text = view === 'reasoning' ? record.nativeReasoning : view === 'diagnostics'
    ? JSON.stringify({ protocol: record.protocol, status: record.status, ...diagnostic }, null, 2) : record.text;
  return <>
    <label>查看响应内容<select aria-label={`${label}原文内容`} value={view} onChange={event => { following.current = true; setView(event.target.value); }}>
      <option value="content">供应商 content</option><option value="reasoning">供应商公开思考</option><option value="diagnostics">安全响应诊断</option>
    </select></label>
    {!record.text?.trim() && record.nativeReasoning && <p role="note">供应商未返回可展示的正文；已收到公开思考。</p>}
    {record.status === 'pending' && <p role="status">响应接收中 · 未完成；尚未通过完整校验，不是候选或正式结果。</p>}
    {text ? <textarea ref={box} onScroll={event => { const e = event.currentTarget; following.current = e.scrollHeight - e.clientHeight - e.scrollTop < 24; }} key={view} className="candidate-json story-raw-text" aria-label={`${label}${view === 'content' ? '模型完整原文' : view === 'reasoning' ? '公开思考原文' : '安全响应诊断'}`} readOnly spellCheck={false} value={text} />
      : <p>{record.status === 'pending' ? '请求尚未返回完整内容。' : view === 'reasoning' ? '未收到供应商独立公开的思考。' : '供应商未返回当前提取器可展示的正文；可查看安全响应诊断。'}</p>}
    {diagnostic && <p className="field-hint">{diagnostic.complete ? '响应传输已结束；是否可用仍以正式校验为准。' : record.status === 'pending' ? '响应接收中。' : '响应未完整接收或完整性未确认。'}{diagnostic.filtered ? ' 供应商明确返回过滤标识。' : ''}{diagnostic.refusal ? ' 供应商明确返回拒绝标识。' : ''}</p>}
    <p className="field-hint">content 与公开思考按来源分别查看，不代表两者的生成先后。最近最多保留六次，容量超限会提前淘汰旧响应。安全诊断仅保留白名单结构，不展示任意供应商错误文字。</p>
    {record.truncated && <p role="note">临时展示已达到容量上限，后续内容未保留；不影响正式解析输入。</p>}
  </>;
}

export function StageResponseText({ saveId, turnId, stage, draft }: { saveId: string; turnId: string; stage: AiStage; draft?: TurnDraft }) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const record = selectStageResponse(records, saveId, turnId, stage, draft);
  return <section aria-label="模型原文">
    <h3>模型原文（临时响应）</h3>
    <StageResponseContent record={record} label={{story:'正文',variables:'变量',world:'动态世界'}[stage]} />
  </section>;
}

export function StageResponsesPanel({ saveId, turnId, draft }: { saveId: string; turnId?: string; draft?: TurnDraft }) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  return <details className="stage-responses" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>查看三阶段模型完整原文与执行结果</summary>
    <p className="field-hint">仅本页面临时保存，刷新或淘汰后无法恢复；模型原文不等于已执行结果。不会写入正式世界或剧情历史，不会发起请求。系统凭证会隐藏。</p>
    {expanded && (['story', 'variables', 'world'] as const).map(stage => {
      const record = selectStageResponse(records, saveId, turnId, stage, draft);
      const label = { story: '正文', variables: '变量', world: '动态世界' }[stage];
      return <ResponseDetail key={stage} record={record} label={label}>
        {record?.error && <p role="note">{record.error.message}{'details' in record.error && record.error.details?.worldRule ? ` · ${worldRuleNames[record.error.details.worldRule]}` : ''}</p>}
        {record?.error && 'details' in record.error && record.error.details?.storyRule && <small>正文失败类型：{record.error.details.storyRule} · {storyRuleNames[record.error.details.storyRule]}</small>}
        {record?.notes?.length ? <div className="stage-notes" role="note"><b>程序处理说明</b><ul>{record.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div> : null}
        {record?.normalized && <details><summary>{label}程序校验后的结果</summary><pre className="candidate-json" tabIndex={0} aria-label={`${label}规范化结果`}>{record.normalized}</pre></details>}
      </ResponseDetail>;
    })}
  </details>;
}

function ResponseDetail({ record, label, children }: { record?: StageResponse; label: string; children: import('react').ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label}模型原文{record?.status === 'failed' ? ' · 未通过验收' : ''}</summary>
    {open && <><StageResponseContent record={record} label={label} />{children}</>}
  </details>;
}
