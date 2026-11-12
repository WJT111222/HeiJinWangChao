import { useState, useSyncExternalStore } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { storyInspections } from '../../services/ai/storyInspection';

export function StoryInspectionPanel({ draft, inline = false }: { draft: TurnDraft; inline?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const records = useSyncExternalStore(storyInspections.subscribe, storyInspections.getSnapshot);
  const item = records.find((value) => value.saveId === draft.saveId && value.turnId === draft.turnId
    && value.baseSaveRevision === draft.baseSaveRevision
    && value.basedOnStoryRevision + (value.status === 'saved' ? 1 : 0) === draft.storyRevision);
  const notice = <p className="muted">主动展开才查看内部资料；不是正文、世界事实或人物知识，不写入存档。刷新清除，不会额外调用模型。</p>;
  const statusText = item && (item.status === 'generating' ? item.activity === 'reasoning' ? '上游正在返回原生内容，尚在生成' : '正在生成' : item.status === 'saved' ? '正文已完整校验并保存，以下仅供调试' : '请求未完成；以下片段未通过完整验收，不可作为事实');
  const planning = item?.planning || '尚未返回项目规划';
  const native = item?.nativeReasoning || '供应商未提供；不影响正文生成，也不代表程序能读取隐藏推理。';
  // PC 三阶段面板：切到“叙事规划”页即为主动查看，直接展开两段内容。
  if (inline) return <section className="story-inspection" aria-label="本次生成的叙事规划与原生输出（临时调试）">
    {!item ? <p className="wf-empty">本页没有对应请求的临时内容；已保存正文可正常恢复。</p> : <>
      <p className="muted">{statusText}</p>
      <h5 className="wf-sec">项目叙事规划 · thinking</h5><pre className="candidate-json" tabIndex={0} aria-label="项目叙事规划">{planning}</pre>
      <h5 className="wf-sec">供应商公开返回的原生内容</h5><pre className="candidate-json" tabIndex={0} aria-label="供应商公开返回的原生内容">{native}</pre>
    </>}
    {notice}
  </section>;
  return <details className="story-inspection" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>本次生成的叙事规划与原生输出（临时调试）</summary>
    {notice}
    {expanded && (!item ? <p>本页没有对应请求的临时内容；已保存正文可正常恢复。</p> : <>
      <p role="status">{statusText}</p>
      <details><summary>项目叙事规划 · thinking</summary><pre>{planning}</pre></details>
      <details><summary>供应商公开返回的原生内容</summary><pre>{native}</pre></details>
    </>)}
  </details>;
}
