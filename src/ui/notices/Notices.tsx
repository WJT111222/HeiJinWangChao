import { Dialog } from '../Dialog';
import { announcement } from './announcement';
import { disclaimer } from './disclaimer';
import type { DisclaimerParagraph } from './disclaimer';
import type { NoticeKind } from './useNotices';

function Paragraphs({ paragraphs }: { paragraphs: readonly DisclaimerParagraph[] }) {
  return paragraphs.map(paragraph => <p key={paragraph.text}>
    {paragraph.emphasis ? <strong>{paragraph.text}</strong> : paragraph.text}
  </p>);
}

export function NoticeLinks({ onOpen }: { onOpen: (kind: NoticeKind) => void }) {
  return (
    <div className="notice-links" role="group" aria-label="游玩信息">
      <button type="button" onClick={() => onOpen('disclaimer')}>游玩须知与免责声明</button>
      <button type="button" onClick={() => onOpen('announcement')}>王朝公告</button>
    </div>
  );
}

export function NoticeDialog({ kind, muted, onMutedChange, onClose }: {
  kind: NoticeKind;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={kind === 'disclaimer' ? disclaimer.title : announcement.title}
      className="notice-modal" closeLabel={kind === 'disclaimer' ? '关闭免责声明' : '关闭王朝公告'} onClose={onClose}>
      <div className="notice-content" tabIndex={0} aria-label={kind === 'disclaimer' ? '免责声明内容' : '公告内容'}>
        {kind === 'disclaimer' ? <>
          <p><strong><span className="notice-age" aria-label="仅限 18 岁及以上">18+</span>{disclaimer.ageNotice}</strong></p>
          <Paragraphs paragraphs={disclaimer.intro} />
          {disclaimer.sections.map(section => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <Paragraphs paragraphs={section.paragraphs} />
            </section>
          ))}
          <hr />
          <Paragraphs paragraphs={disclaimer.closing} />
        </> : <>
          <h3 className="notice-theme">{announcement.theme}</h3>
          <ul>{announcement.updates.map(update => <li key={update}>{update}</li>)}</ul>
          <p className="notice-message">{announcement.message}</p>
        </>}
      </div>
      <footer className="notice-footer">
        <label><input type="checkbox" checked={muted} onChange={event => onMutedChange(event.target.checked)} />今日不再弹出</label>
      </footer>
    </Dialog>
  );
}
