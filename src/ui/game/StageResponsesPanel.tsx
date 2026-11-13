import { storyRuleNames } from '../../domain/storyDiagnostics';
import { useState, useSyncExternalStore } from 'react';
import { stageResponses } from '../../services/ai/stageResponses';
import type { StageResponse } from '../../services/ai/stageResponses';
import { worldRuleNames } from '../../services/validation/worldDiagnostics';
import type { AiStage } from '../../services/ai/configuration';

export function StageResponseContent({ record, label }: { record?: StageResponse; label: string }) {
  return <>
    {!record?.text ? <p>{record?.status === 'pending' ? '请求尚未返回完整内容。' : '本页面没有可恢复的模型原文；已保存的候选不是模型原文，刷新后请查看规范化记录。'}</p>
      : <pre className="candidate-json" tabIndex={0} aria-label={`${label}模型完整原文`}>{record.text}</pre>}
    {record?.stage === 'story' && record.nativeReasoning && <section className="story-native-response" aria-label="供应商公开原生思考">
      <h5 className="wf-sec">供应商公开原生思考</h5>
      <p className="field-hint">来源：{record.protocol ?? '供应商'} 独立响应字段（如 reasoning_content）。与文本原文分区展示，排列不代表真实返回先后。</p>
      <pre className="candidate-json" tabIndex={0} aria-label="供应商公开原生思考全文">{record.nativeReasoning}</pre>
    </section>}
  </>;
}

export function StageResponseText({ saveId, turnId, stage }: { saveId: string; turnId: string; stage: AiStage }) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const record = records.find(item => item.saveId === saveId && item.turnId === turnId && item.stage === stage);
  return <section aria-label="模型原文">
    <h3>模型原文（临时响应）</h3>
    <StageResponseContent record={record} label={{story:'正文',variables:'变量',world:'动态世界'}[stage]} />
  </section>;
}

export function StageResponsesPanel({ saveId, turnId }: { saveId: string; turnId?: string }) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  return <details className="stage-responses" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>查看三阶段模型完整原文与执行结果</summary>
    <p className="field-hint">仅本页面临时保存，刷新或淘汰后无法恢复；模型原文不等于已执行结果。不会写入正式世界或剧情历史，不会发起请求。系统凭证会隐藏。</p>
    {expanded && (['story', 'variables', 'world'] as const).map(stage => {
      const record = records.find(item => item.saveId === saveId && item.turnId === turnId && item.stage === stage);
      const label = { story: '正文', variables: '变量', world: '动态世界' }[stage];
      return <details key={stage}>
        <summary>{label}模型原文{record?.status === 'failed' ? ' · 未通过验收' : ''}</summary>
        <StageResponseContent record={record} label={label} />
        {record?.error && <p role="note">{record.error.message}{'details' in record.error && record.error.details?.worldRule ? ` · ${worldRuleNames[record.error.details.worldRule]}` : ''}</p>}
        {record?.error && 'details' in record.error && record.error.details?.storyRule && <small>正文失败类型：{record.error.details.storyRule} · {storyRuleNames[record.error.details.storyRule]}</small>}
        {record?.normalized && <details><summary>{label}程序校验后的结果</summary><pre className="candidate-json" tabIndex={0} aria-label={`${label}规范化结果`}>{record.normalized}</pre></details>}
      </details>;
    })}
  </details>;
}
