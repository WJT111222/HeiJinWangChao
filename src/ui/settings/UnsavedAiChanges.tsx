import { Dialog } from '../Dialog';

export function UnsavedAiChanges({ onContinue, onDiscard, subject }: { subject?: string; onContinue: () => void; onDiscard: () => void }) {
  return <Dialog title={subject ? `${subject}尚未保存` : "AI 配置尚未保存"} small onClose={onContinue}>
    <p>{subject ? `${subject}的修改尚未保存，请继续编辑并保存，或明确放弃。` : <>渠道、模型或密钥的修改尚未保存。继续编辑后点击「保存 AI 配置」，或明确放弃本次修改。</>}</p>
    <div className="dialog-actions">
      <button className="primary" onClick={onContinue}>继续编辑</button>
      <button onClick={onDiscard}>放弃本次修改</button>
    </div>
  </Dialog>;
}
