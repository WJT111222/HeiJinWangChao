import { useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { Dialog } from '../Dialog';

export function VariableCandidates({ draft }: { draft: TurnDraft }) {
  const [opened, setOpened] = useState(false),
    [revealed, setRevealed] = useState(false);
  const result = draft.variables?.result;
  if (!result) return null;
  return (
    <>
      <button
        onClick={() => {
          setRevealed(false);
          setOpened(true);
        }}
      >
        查看变量候选（未结算）
      </button>
      {opened && (
        <Dialog title="变量候选 · 未正式结算" onClose={() => setOpened(false)}>
          <p>
            正文版本 {draft.storyRevision} · 执行版本 {draft.executionRevision} · 候选版本{' '}
            {draft.variables?.candidateRevision}
          </p>
          <p>
            合法命令 {result.commands.length} 条；拒绝建议 {result.rejectedSuggestions.length}{' '}
            条；未解决事项 {result.unresolved.length} 条。
          </p>
          <ul>
            {result.commands.map((command) => (
              <li key={command.commandId}>
                {command.type} · {command.commandId}
              </li>
            ))}
          </ul>
          <p className="notice">
            候选尚未改变任何正式资金、人物或时间。完整候选可能包含 NPC
            内部资料；查看不会更新主角认知或普通历史。
          </p>
          <button aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
            {revealed ? '隐藏完整变量候选' : '主动查看完整变量候选'}
          </button>
          {revealed && (
            <pre className="candidate-json" tabIndex={0} aria-label="完整变量候选">
              {JSON.stringify(redactInspection(result, browserCredentials()), null, 2)}
            </pre>
          )}
        </Dialog>
      )}
    </>
  );
}
