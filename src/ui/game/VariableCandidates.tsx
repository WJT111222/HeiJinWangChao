import { useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { useDesktopFeedback } from '../Feedback';
import { Dialog } from '../Dialog';
import { StageResponseText } from './StageResponsesPanel';

export function VariableCandidates({ draft }: { draft: TurnDraft }) {
  const desktop = useDesktopFeedback();
  const [opened, setOpened] = useState(false),
    [revealed, setRevealed] = useState(false), [rawOpened,setRawOpened]=useState(false);
  const result = draft.variables?.result;
  if (!result) return null;
  return (
    <>
      <button
        className="candidate-opener"
        onClick={() => {
          setRevealed(false);setRawOpened(false);
          setOpened(true);
        }}
      >
        查看变量候选（未结算）
      </button>
      {opened && (
        <Dialog
          className="candidate-dialog" mobileVariant="sheet" sheetFull seal="变" footer={<button onClick={()=>setOpened(false)}>关闭</button>}
          eyebrow="STAGE 02 · VARIABLES"
          badge={<span className="candidate-badge l-warn">未正式结算</span>}
          title="变量候选 · 未正式结算"
          onClose={() => setOpened(false)}
        >
          {(
            <div className="candidate-grid">
              <aside className="candidate-side">
                <dl className="candidate-versions">
                  <div><dt>正文版本</dt><dd>{draft.storyRevision}</dd></div>
                  <div><dt>执行版本</dt><dd>{draft.executionRevision}</dd></div>
                  <div><dt>候选版本</dt><dd>{draft.variables?.candidateRevision}</dd></div>
                </dl>
                <div className="candidate-counts">
                  <p className="l-ok">
                    合法命令<b>{result.commands.length}</b>
                  </p>
                  <p className="l-err">
                    拒绝建议<b>{result.rejectedSuggestions.length}</b>
                  </p>
                  <p className="l-warn">
                    未解决事项<b>{result.unresolved.length}</b>
                  </p>
                </div>{' '}
                <button
                  className="raw-toggle"
                  aria-expanded={revealed}
                  onClick={() => setRevealed(!revealed)}
                >
                  {revealed ? '隐藏完整变量候选' : '主动查看完整变量候选'}
                </button>
                {revealed && (
                  <pre className="candidate-json" tabIndex={0} aria-label="完整变量候选">
                    {JSON.stringify(redactInspection(result, browserCredentials()), null, 2)}
                  </pre>
                )}
              </aside>
              <section className="candidate-main">
                <h3>程序编译和校验后的候选</h3>
                <ul className="candidate-commands">
                  {result.commands.map((command) => (
                    <li key={command.commandId}>
                      <code>{command.type}</code>
                      <span>{redactInspection(command.evidence, browserCredentials())}</span>
                      <small>{redactInspection(command.commandId, browserCredentials())}</small>
                    </li>
                  ))}
                  {result.rejectedSuggestions.map((item, i) => (
                    <li className="l-err" key={`rejected-${i}`}>
                      <code>拒绝</code>
                      <span>{redactInspection(item.reason, browserCredentials())}</span>
                      {item.reference && <small>{redactInspection(item.reference, browserCredentials())}</small>}
                    </li>
                  ))}
                  {result.unresolved.map((item, i) => (
                    <li className="l-warn" key={`unresolved-${i}`}>
                      <code>未解决</code>
                      <span>{redactInspection(item, browserCredentials())}</span>
                    </li>
                  ))}
                </ul>{' '}
                <p className="notice">
                  候选尚未改变任何正式资金、人物或时间。完整候选可能包含 NPC
                  内部资料；查看不会更新主角认知或普通历史。
                </p>
                {desktop?<StageResponseText saveId={draft.saveId} turnId={draft.turnId} stage="variables" />:<details className="candidate-response" onToggle={e=>setRawOpened(e.currentTarget.open)}><summary>模型原文（临时响应）</summary>{rawOpened&&<StageResponseText saveId={draft.saveId} turnId={draft.turnId} stage="variables" />}</details>}
              </section>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
