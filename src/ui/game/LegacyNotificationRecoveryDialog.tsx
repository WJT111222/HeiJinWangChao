import { useState } from 'react';
import { Dialog } from '../Dialog';
import type { LegacyNotificationSelection } from '../../domain/events/legacyNotification';
import type { legacyNotificationRecoveryOptions } from '../../domain/legacyNotificationRecovery';

export function LegacyNotificationRecoveryDialog({ options, narrative, onClose, onConfirm }: {
  options: ReturnType<typeof legacyNotificationRecoveryOptions>;
  narrative: string;
  onClose: () => void;
  onConfirm: (selection: LegacyNotificationSelection) => void;
}) {
  const [eventId,setEventId] = useState('');
  const [notificationOnly,setNotificationOnly] = useState(false);
  const [finishReading,setFinishReading] = useState(false);
  const selected = options.find(option => option.eventId === eventId);
  return <Dialog title="修复旧通知回合" seal="复" mobileVariant="sheet" onClose={onClose}>
    <p>当前正文已保存，但动态世界未能结算。仅在这条旧入场是纯通知时使用此恢复。</p>
    <label>选择旧入场
      <select value={eventId} onChange={event => {
        setEventId(event.target.value);
        setNotificationOnly(false);
        setFinishReading(false);
      }}>
        <option value="">请选择</option>
        {options.map(option => <option key={option.eventId} value={option.eventId}>{option.title}（{option.eventId}）</option>)}
      </select>
    </label>
    {selected && <>
      <p>当前入场状态为「已呈现、待处理」。</p>
      <p>{selected.cue}</p>
      <label className="checkbox"><input type="checkbox" checked={notificationOnly}
        onChange={event => setNotificationOnly(event.target.checked)} />我确认这只是通知，无需我批准、选择、回应或参与。</label>
      <label className="checkbox"><input type="checkbox" checked={finishReading}
        onChange={event => setFinishReading(event.target.checked)} />我选择在本幕读完或听完这条通知，仅收悉。</label>
    </>}
    <p>确认后仅重新生成正文，可能产生模型费用。成功时替换本回合正文并使旧下游候选失效。之后由你决定是否继续变量和动态世界。正式存档在结算前保持原样。</p>
    <details><summary>查看或复制原正文</summary>
      <textarea aria-label="原正文" readOnly rows={6} value={narrative} />
    </details>
    <div className="actions">
      <button type="button" onClick={onClose}>放弃修复</button>
      <button type="button" className="primary" disabled={!selected || !notificationOnly || !finishReading} onClick={() => {
        if (selected && notificationOnly && finishReading)
          onConfirm({eventId:selected.eventId,entryId:selected.entryId,notificationOnly:true,finishReading:true});
      }}>确认重做正文</button>
    </div>
  </Dialog>;
}
