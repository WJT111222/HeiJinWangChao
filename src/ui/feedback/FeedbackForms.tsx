import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { Dialog } from '../Dialog';
import type { RuntimeLogEntry } from '../game/runtimeLog';
import { nativeFetch } from '../../presets/tavern/fetch';
import { prepareErrorPayload, suggestionPayload } from '../../services/feedback/report';
import { feedbackCategories, feedbackPath, feedbackSchema, feedbackTextLimit, submissionIdSchema } from '../../services/feedback/contract';
import type { FeedbackCategory, FeedbackPayload } from '../../services/feedback/contract';
import { stageResponses } from '../../services/ai/stageResponses';
import './anonymous-feedback.css';

function useFeedbackSubmission() {
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [failure, setFailure] = useState('');
  const pending = useRef(false);
  const previous = useRef<{ payload: string; id: string } | undefined>(undefined);

  async function send(event: FormEvent, value: FeedbackPayload) {
    event.preventDefault();
    if (pending.current) return;
    const parsed = feedbackSchema.safeParse(value);
    if (!parsed.success) { setFailure('请检查反馈内容和附件。'); return; }
    const payload = JSON.stringify(parsed.data);
    if (previous.current?.payload !== payload) previous.current = { payload, id: crypto.randomUUID() };
    pending.current = true;
    setSending(true);
    setFailure('');
    setReceipt('');
    try {
      const response = await nativeFetch(feedbackPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ submissionId: previous.current.id, feedback: parsed.data }),
      });
      if (!response.ok) {
        setFailure(response.status === 429 ? '反馈提交较多，请稍后重试。'
          : response.status === 413 ? '报告过大，请取消部分附件后重试。' : '提交失败，内容已保留，可以重试。');
        return;
      }
      const result = await response.json();
      const parsedId = submissionIdSchema.safeParse(result.id);
      if (!parsedId.success) throw new Error('Invalid receipt');
      setReceipt(parsedId.data);
      previous.current = undefined;
    } catch {
      setFailure('暂时无法提交，内容已保留，可以重试。');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }
  return { send, sending, receipt, failure };
}

function Result({ receipt, failure }: { receipt: string; failure: string }) {
  if (failure) return <p role="alert" className="feedback-form-error">{failure}</p>;
  if (receipt) return <p role="status" className="feedback-form-receipt">已提交，反馈编号 <strong>{receipt}</strong></p>;
  return null;
}

export function SuggestionFeedback() {
  const [category, setCategory] = useState<FeedbackCategory>('suggestion');
  const [text, setText] = useState('');
  const submit = useFeedbackSubmission();
  return <form className="feedback-form" onSubmit={event => void submit.send(event, suggestionPayload(category, text))}>
    <p>欢迎向开发者提出建议或分享游玩体验。</p>
    <p className="field-hint">所有反馈均为匿名提交。</p>
    <label>反馈类型
      <select value={category} disabled={submit.sending || Boolean(submit.receipt)}
        onChange={event => setCategory(event.target.value as FeedbackCategory)}>
        {Object.entries(feedbackCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label>反馈内容
      <textarea value={text} required maxLength={feedbackTextLimit} rows={6}
        disabled={submit.sending || Boolean(submit.receipt)} onChange={event => setText(event.target.value)} />
    </label>
    <Result {...submit} />
    <button className="primary" type="submit" disabled={!text.trim() || submit.sending || Boolean(submit.receipt)}>
      {submit.sending ? '提交中…' : '提交反馈'}
    </button>
  </form>;
}

export function ErrorFeedbackDialog({ entries, onClose }: { entries: readonly RuntimeLogEntry[]; onClose: () => void }) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  const [note, setNote] = useState('');
  const [content, setContent] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const submit = useFeedbackSubmission();
  const disabled = submit.sending || Boolean(submit.receipt);
  const makeReport = useMemo(() => prepareErrorPayload(entries, records, { content, reasoning }), [entries, records, content, reasoning]);
  const report = makeReport(note);
  const reportJson = JSON.stringify(report, null, 2);
  return <Dialog title="上报错误" small seal="报" eyebrow="ANONYMOUS FEEDBACK" mobileVariant="sheet" sheetFull fitVisualViewport
    className="feedback-report-dialog" closeLabel="关闭错误上报" closeDisabled={submit.sending} onClose={() => !submit.sending && onClose()}>
    <form className="feedback-form" onSubmit={event => void submit.send(event, report)}>
      <p>提交时将自动附带当前保留的错误日志。</p>
      <p><strong>{report.errors.length} 条错误日志</strong></p>
      <label>补充说明（选填）
        <textarea value={note} disabled={disabled} maxLength={feedbackTextLimit} rows={4} onChange={event => setNote(event.target.value)} />
      </label>
      <label className="feedback-option"><input type="checkbox" checked={content} disabled={disabled}
        onChange={event => setContent(event.target.checked)} />附带最近保留的报错环节模型原文</label>
      <label className="feedback-option"><input type="checkbox" checked={reasoning} disabled={disabled}
        onChange={event => setReasoning(event.target.checked)} />附带最近保留的报错环节公开思考</label>
      {((content && !report.attachments?.some(item => item.content))
        || (reasoning && !report.attachments?.some(item => item.reasoning))) && <p className="field-hint">没有可附带的对应内容，仍可提交错误日志。</p>}
      {report.attachments?.some(item => item.truncated) && <p className="field-hint">部分附件已截短，可在预览中查看。</p>}
      <details><summary>预览上传内容</summary>
        <textarea readOnly aria-label="上传内容预览" rows={8} value={reportJson} />
      </details>
      <p className="field-hint">完全匿名，无需登录或填写联系方式。</p>
      <Result {...submit} />
      <button className="primary" type="submit" disabled={disabled || !report.errors.length}>
        {submit.sending ? '提交中…' : '提交错误报告'}
      </button>
    </form>
  </Dialog>;
}
