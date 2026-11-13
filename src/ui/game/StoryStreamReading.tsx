import type { StoryProgress } from '../../workflows/storyStage';

/** Temporary display only. Never feeds a parser, candidate or repository write. */
export function StoryStreamReading({ progress, caret = false }: { progress: StoryProgress; caret?: boolean }) {
  if (progress.readingPhase === 'body' || progress.phase === 'saving' || progress.narrative) {
    return <p className="prose" data-testid="stream-narrative">{progress.narrative}{caret && <span className="caret" aria-hidden="true" />}</p>;
  }
  // Prefer the independent provider field when it already covers the same text.
  // Distinct source contents remain separate; never infer identity from similarity.
  const compatibility = progress.compatibilityReasoning && !progress.nativeReasoning?.startsWith(progress.compatibilityReasoning)
    ? progress.compatibilityReasoning : undefined;
  return <section className="story-stream-thinking" aria-label="生成中的公开思考">
    {progress.nativeReasoning && <section aria-label="供应商公开思考">
      <h3>供应商公开思考</h3><p className="prose">{progress.nativeReasoning}</p>
    </section>}
    {compatibility && <section aria-label="兼容文本思考">
      <h3>兼容文本思考 · &lt;think&gt;</h3><p className="prose">{compatibility}</p>
      <p className="field-hint">来源：响应文本开头的 &lt;think&gt;，不是独立 reasoning_content 字段。</p>
    </section>}
    {progress.planning && <section aria-label="项目 thinking 内容">
      <h3>项目 &lt;thinking&gt;</h3><p className="prose">{progress.planning}</p>
    </section>}
    {!progress.nativeReasoning && !progress.planning && !compatibility
      ? <p role="status" className="muted">正在等待模型内容…</p>
      : <p className="field-hint">临时内容按来源分区，排列不代表返回先后；正文开始后此处清空。</p>}
  </section>;
}
