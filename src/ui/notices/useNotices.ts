import { announcement as fallback } from './announcement';
import { currentAnnouncement } from '../../services/notices/client';
import { useEffect, useState } from 'react';
import { noticesMutedToday, saveNoticePreference } from './preferences';

export type NoticeKind = 'disclaimer' | 'announcement';
interface NoticeState { kind?: NoticeKind; automatic: boolean; muted: boolean }

export function useNotices() {
  // 只在 App 本次挂载时读取，不随导航或存档更新重启。初始化没有写入副作用。
  const [state, setState] = useState<NoticeState>(() => {
    const muted = noticesMutedToday();
    return { kind: muted ? undefined : 'disclaimer', automatic: !muted, muted };
  });
  const [announcement, setAnnouncement] = useState(fallback);
  useEffect(() => {
    let active = true;
    void currentAnnouncement().then(value => { if (active) setAnnouncement(value); });
    return () => { active = false; };
  }, []);
  function close() {
    setState(current => {
      // 旧弹窗的重复关闭回调不能连带关闭下一张弹窗。
      if (current.kind !== state.kind) return current;
      return current.automatic && current.kind === 'disclaimer'
        ? { ...current, kind: 'announcement' }
        : { ...current, kind: undefined, automatic: false };
    });
  }
  function setMuted(muted: boolean) {
    saveNoticePreference(muted);
    setState(current => ({ ...current, muted }));
  }
  function open(kind: NoticeKind) {
    setState({ kind, automatic: false, muted: noticesMutedToday() });
  }
  return { ...state, announcement, close, setMuted, open };
}
