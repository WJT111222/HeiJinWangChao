import type { TurnDraft } from '../../domain/drafts';
import type { RuntimeLogEntry } from './runtimeLog';
import { runtimeStageNames } from './runtimeLog';

export function currentDraftFailures(draft?: TurnDraft) {
  return draft?.failures.filter(f => f.storyRevision === draft.storyRevision && draft.stageStatus[f.stage] === 'failed').slice(-6) ?? [];
}

/** Persisted codes are not page events and cannot reconstruct lost raw responses. */
export function SavedFailureSummary({ draft, entries, recovery }: {
  draft?: TurnDraft; entries: readonly RuntimeLogEntry[]; recovery?: string;
}) {
  const failures = currentDraftFailures(draft);
  if (!failures.length) return null;
  const missing = failures.some(f => !entries.some(e => e.kind === 'failed' && e.stage === f.stage && e.code === f.errorCode));
  return <section aria-label="持久失败摘要" className="saved-failure-summary">
    <h5>持久失败摘要</h5>
    {failures.map((f, i) => <p key={i}>{runtimeStageNames[f.stage]} · 安全失败码：{f.errorCode} · 第 {f.attempt} 次尝试</p>)}
    {missing && <p className="field-hint">当前回合保留了生成失败记录，但本页没有该次请求的详细运行日志。刷新、重新进入游戏、清空或淘汰记录后，临时日志无法恢复。</p>}
    <p className="field-hint">{recovery ?? '是否可继续或重试，请以当前阶段操作按钮为准。'}</p>
    <p className="field-hint">持久失败摘要仅保留安全码和尝试信息，不是本页新发生的事件，也不是模型原始响应；不能凭错误码还原具体失败原因。</p>
  </section>;
}
