import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { awaitingPlayerAction } from '../../domain/turnCommit';
import type { SaveRepository, TurnUndoResult } from '../../services/storage/saveRepository';
import type { UndoStatus } from '../../services/storage/turnUndo';
import { DataError } from '../../domain/common';
import { Feedback, useDesktopFeedback } from '../Feedback';
import { Dialog } from '../Dialog';

export function TurnUndoControl({ repository, state, draft, busy, input, onInput, onUndone, cancelMemory, onNotice, compact=false }: {
  repository: SaveRepository; state: GameState; draft?: TurnDraft; busy: boolean; input: string;
  onInput: (value: string) => void; onUndone: (result: TurnUndoResult) => void; cancelMemory: () => void;
  onNotice: (message: string) => void; compact?:boolean;
}) {
  const desktop = useDesktopFeedback();
  const [status, setStatus] = useState<UndoStatus>();
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false), operation = useRef<string | undefined>(undefined);
  const current = useRef({ input, onInput, onUndone }); current.current = { input, onInput, onUndone };
  const initialized = useRef(false);
  useEffect(() => {
    onNotice(error || (status?.notice ? `回合已正式保存；${status.notice === 'legacy_write'
      ? '独立状态修改后，旧恢复点已失效。' : '受存储容量限制，本回合不支持撤回。'}` : ''));
  }, [error, status, onNotice]);
  useEffect(() => {
    let disposed = false;
    void repository.undoStatus(state.saveId).then(next => {
      if (disposed) return;
      setStatus(next);
      setError('');
      if (!initialized.current && !current.current.input) current.current.onInput(next.input);
      initialized.current = true;
    }).catch(() => { if (!disposed) { setStatus(undefined); setError('无法读取撤回记录，请重新读取存档。'); } });
    return () => { disposed = true; };
  }, [repository, state.saveId, state.revision]);
  useEffect(() => {
    if (!status?.memoryPaused || !draft || !awaitingPlayerAction(state, draft) || input === status.input) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void repository.saveUndoInput(draft, input).catch(() => {
        if (!disposed) setError('回填文字修改未保存，请保留输入并重新读取存档。');
      });
    }, 250);
    return () => { disposed = true; clearTimeout(timer); };
  }, [repository, draft, state, input, status]);
  async function undo() {
    if (busy || active.current || !status?.available) return;
    active.current = true; setSaving(true); setError(''); cancelMemory();
    operation.current ??= `undo-${crypto.randomUUID()}`;
    try {
      const result = await repository.undoTurn({ saveId: state.saveId, expectedRevision: state.revision,
        expectedDraft: draft, operationId: operation.current });
      current.current.onUndone(result);
      setConfirm(false);
    } catch (failure) {
      // A rejected/stale confirmation is not proof that the previously displayed
      // checkpoint is still available. Reload before authorizing another undo.
      setStatus(undefined);
      setError(failure instanceof DataError && ['REVISION_CONFLICT', 'DRAFT_CONFLICT', 'STORY_BUSY'].includes(failure.code)
        ? '存档或草稿正在另一处操作，请重新读取后再撤回。'
        : '撤回未完成，存档未部分修改。请重新读取存档后检查恢复点。');
    } finally { active.current = false; setSaving(false); }
  }
  const reason = !status ? '正在检查恢复点' : status.unavailable === 'opening' ? '开局不可撤回'
    : status.unavailable === 'chain' ? '恢复点不连续，请重新读取存档' : '没有可靠的回合恢复点';
  return <>
    <button aria-label={compact?`撤回${status?.available?`（${status.available}）`:""}`:undefined} disabled={busy || saving || !status?.available} title={status?.available ? `可连续撤回 ${status.available} 回合` : reason}
      onClick={() => setConfirm(true)}>{compact?<span aria-hidden="true">撤</span>:<>撤回{status?.available ? `（${status.available}）` : ''}</>}</button>
    {confirm && <Dialog title="撤回上一回合" small feedback="warn" seal="撤" onClose={() => { if (!saving) setConfirm(false); }}>
      {desktop ? <><p>恢复到第 {state.turnNumber - 1} 回合结束，回填原行动。</p><ul className="dialog-consequences"><li>已撤回的剧情无法重做；此操作不调用 AI。</li>
        {draft && !awaitingPlayerAction(state, draft) && <li>当前未结算草稿会被丢弃。</li>}
        {input && <li>输入框现有文字会被本次回填替换。</li>}</ul></> : <>      <p>恢复到第 {state.turnNumber - 1} 回合结束，回填原行动。已撤回的剧情无法重做；此操作不调用 AI。</p>
      {draft && !awaitingPlayerAction(state, draft) && <p>当前未结算草稿会被丢弃。</p>}
      {input && <p>输入框现有文字会被本次回填替换。</p>}
</>}
      {desktop && error && <Feedback level="err" role="alert">{error}</Feedback>}
      <div className="button-row feedback-dialog-actions">
        <button disabled={saving} onClick={() => setConfirm(false)}>保留当前回合</button>
        <button className="feedback-danger" disabled={busy || saving} onClick={() => void undo()}>{saving ? '正在撤回…' : '确认撤回'}</button>
      </div>
      {!desktop && error && <p role="alert">{error}</p>}
    </Dialog>}
  </>;
}
