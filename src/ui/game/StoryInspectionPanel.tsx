import { useState, useSyncExternalStore } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { storyInspections } from '../../services/ai/storyInspection';

export function StoryInspectionPanel({ draft }: { draft: TurnDraft }) {
  const [expanded, setExpanded] = useState(false);
  const records = useSyncExternalStore(storyInspections.subscribe, storyInspections.getSnapshot);
  const item = records.find((value) => value.saveId === draft.saveId && value.turnId === draft.turnId
    && value.baseSaveRevision === draft.baseSaveRevision
    && value.basedOnStoryRevision + (value.status === 'saved' ? 1 : 0) === draft.storyRevision);
  return <details className="story-inspection" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>本次生成的叙事规划与原生输出（临时调试）</summary>
    <p className="muted">主动展开才查看内部资料；不是正文、世界事实或人物知识，不写入存档。刷新清除，不会额外调用模型。</p>
    {expanded && (!item ? <p>本页没有对应请求的临时内容；已保存正文可正常恢复。</p> : <>
      <p role="status">{item.status === 'generating' ? item.activity === 'reasoning' ? '上游正在返回原生内容，尚在生成' : '正在生成' : item.status === 'saved' ? '正文已完整校验并保存，以下仅供调试' : '请求未完成；以下片段未通过完整验收，不可作为事实'}</p>
      <p>最大输出 Token：{item.budget.maxOutputTokens ?? '未提供'}；规划及正文粗估需求：≈ {item.budget.estimatedTokens}（非实际消耗，未计未知原生预算）。</p>
      {item.budget.warning && <p className="muted">{item.budget.warning}</p>}
      <details><summary>项目叙事规划 · thinking</summary><pre>{item.planning || '尚未返回项目规划'}</pre></details>
      <details><summary>供应商公开返回的原生内容</summary><pre>{item.nativeReasoning || '供应商未提供；不影响正文生成，也不代表程序能读取隐藏推理。'}</pre></details>
    </>)}
  </details>;
}
