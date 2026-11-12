import { useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { useDesktopFeedback } from '../Feedback';
import { Dialog } from '../Dialog';
import { StageResponseText } from './StageResponsesPanel';

export function WorldCandidates({ draft }: { draft: TurnDraft }) {
  const desktop = useDesktopFeedback();
  const [opened, setOpened] = useState(false),
    [revealed, setRevealed] = useState(false);
  const candidate = draft.world;
  if (!candidate) return null;
  const result = candidate.result;
  return (
    <>
      <button
        className="candidate-opener"
        onClick={() => {
          setRevealed(false);
          setOpened(true);
        }}
      >
        查看世界候选（未结算）
      </button>
      {opened && (
        <Dialog
          className="candidate-dialog"
          eyebrow="STAGE 03 · WORLD"
          badge={
            <span
              className={`candidate-badge l-${candidate.validation === 'preview' ? 'warn' : 'ok'}`}
            >
              {candidate.validation === 'preview'
                ? '预览 · 变量依赖未完成，不能正式结算'
                : '程序校验通过 · 仍未正式结算'}
            </span>
          }
          title="世界候选 · 未正式结算"
          onClose={() => setOpened(false)}
        >
          {desktop ? (
            <div className="candidate-grid">
              <aside className="candidate-side">
                <dl className="candidate-versions">
                  <div><dt>正文版本</dt><dd>{candidate.storyRevision}</dd></div>
                  <div><dt>变量候选版本</dt><dd>{candidate.basedOnVariableRevision ?? '缺失'}</dd></div>
                  <div><dt>世界候选版本</dt><dd>{candidate.candidateRevision}</dd></div>
                </dl>
                <div className="candidate-counts">
                  <p className="l-ok">场外命令<b>{result.worldCommands.length}</b></p>
                  <p className="l-info">任务<b>{result.taskCommands.length}</b></p>
                  <p className="l-info">事件<b>{result.eventCommands.length}</b></p>
                  <p className="l-warn">未解决事项<b>{result.unresolved.length}</b></p>
                </div>
                <p>未来计划 {result.eventCommands.filter(command => command.type === 'SaveEvent' && command.event.status === 'scheduled').length} 条。</p>
                <p>
                  线索候选 {result.visibleHooks.length} 条；时间轴候选{' '}
                  {
                    result.worldCommands.filter((command) => command.type === 'RecordHistory')
                      .length
                  }{' '}
                  条；未解决事项 {result.unresolved.length} 条。
                </p>
                <button
                  className="raw-toggle"
                  aria-expanded={revealed}
                  onClick={() => setRevealed(!revealed)}
                >
                  {revealed ? '隐藏完整世界候选' : '主动查看完整世界候选'}
                </button>
                {revealed && (
                  <pre className="candidate-json" tabIndex={0} aria-label="完整世界候选">
                    {JSON.stringify(redactInspection(result, browserCredentials()), null, 2)}
                  </pre>
                )}
              </aside>
              <section className="candidate-main">
                <h3>程序校验后的候选</h3>
                <ul className="candidate-commands">
                  {[...result.worldCommands, ...result.taskCommands, ...result.eventCommands].map(
                    (command, i) => (
                      <li key={i}>
                        <code>{command.type}</code>
                        <span>{redactInspection(command.evidence, browserCredentials())}</span>
                        <small>{redactInspection(command.commandId, browserCredentials())}</small>
                      </li>
                    ),
                  )}
                  {result.unresolved.map((item, i) => (
                    <li className="l-warn" key={`unresolved-${i}`}>
                      <code>未解决</code>
                      <span>{redactInspection(item, browserCredentials())}</span>
                    </li>
                  ))}
                </ul>{' '}
                <p className="notice">
                  此处为只读候选。未改变正式人物、经济、任务、时间或历史；线索尚未发布。查看内部结果不会更新任何人物认知。
                </p>
                <StageResponseText saveId={draft.saveId} turnId={draft.turnId} stage="world" />
              </section>
            </div>
          ) : (
            <>
              <StageResponseText saveId={draft.saveId} turnId={draft.turnId} stage="world" />
              <h3>程序校验后的候选</h3>
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
                场外命令 {result.worldCommands.length} 条；任务 {result.taskCommands.length}{' '}
                条；事件 {result.eventCommands.length} 条；未来计划{' '}
                {
                  result.eventCommands.filter(
                    (command) =>
                      command.type === 'SaveEvent' && command.event.status === 'scheduled',
                  ).length
                }{' '}
                条。
              </p>
              <p>
                线索候选 {result.visibleHooks.length} 条；时间轴候选{' '}
                {result.worldCommands.filter((command) => command.type === 'RecordHistory').length}{' '}
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
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
