import { useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { Dialog } from '../Dialog';

export function WorldCandidates({ draft }: { draft: TurnDraft }) {
  const [opened, setOpened] = useState(false),
    [revealed, setRevealed] = useState(false);
  const candidate = draft.world;
  if (!candidate) return null;
  const result = candidate.result;
  return (
    <>
      <button
        onClick={() => {
          setRevealed(false);
          setOpened(true);
        }}
      >
        查看世界候选（未结算）
      </button>
      {opened && (
        <Dialog title="世界候选 · 未正式结算" onClose={() => setOpened(false)}>
          <p>
            正文版本 {candidate.storyRevision} · 变量候选版本{' '}
            {candidate.basedOnVariableRevision ?? '缺失'} · 世界候选版本{' '}
            {candidate.candidateRevision}
          </p>
          <p>
            {candidate.validation === 'preview'
              ? '预览 · 变量依赖未完成，不能正式结算'
              : '程序校验通过 · 仍未正式结算'}
          </p>
          <p>
            场外命令 {result.worldCommands.length} 条；任务 {result.taskCommands.length} 条；事件{' '}
            {result.eventCommands.length} 条；未来计划 {result.futureEvents.length} 条。
          </p>
          <p>
            线索候选 {result.visibleHooks.length} 条；时间轴候选 {result.timelineCandidates.length}{' '}
            条；未解决事项 {result.unresolved.length} 条。
          </p>
          <p className="notice">
            此处为只读候选。未改变正式人物、经济、任务、时间或历史；线索尚未发布。查看内部结果不会更新任何人物认知。
          </p>
          <button aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
            {revealed ? '隐藏完整世界候选' : '主动查看完整世界候选'}
          </button>
          {revealed && (
            <pre className="candidate-json" tabIndex={0} aria-label="完整世界候选">
              {JSON.stringify(redactInspection(result, browserCredentials()), null, 2)}
            </pre>
          )}
        </Dialog>
      )}
    </>
  );
}
