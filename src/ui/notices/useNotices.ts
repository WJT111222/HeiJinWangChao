import { announcement as fallback } from './announcement';
import { currentAnnouncement } from '../../services/notices/client';
import { useEffect, useRef, useState } from 'react';
import type { Announcement } from '../../services/notices/announcement';
import { noticeMuteToday, noticesMutedFor, saveNoticePreference } from './preferences';

export type NoticeKind = 'disclaimer' | 'announcement';
interface NoticeState { kind?: NoticeKind; automatic: boolean; muted: boolean }

/** 远程取回的真实公告；请求失败或服务端回退到内置公告都不算「有新公告」。 */
function remote(value: Announcement) {
  return value !== fallback && value.version !== fallback.version;
}

export function useNotices() {
  // 只在 App 本次挂载时读取，不随导航或存档更新重启。初始化没有写入副作用。
  const [initialMute] = useState(() => noticeMuteToday());
  const [state, setState] = useState<NoticeState>(() => initialMute
    ? { kind: undefined, automatic: false, muted: true }
    : { kind: 'disclaimer', automatic: true, muted: false });
  const [announcement, setAnnouncement] = useState(fallback);
  // 本次页面里是否勾选了「今日不再弹出」（可能早于远程公告加载完成）。
  const mutedHere = useRef(false);
  useEffect(() => {
    let active = true;
    void currentAnnouncement().then(value => {
      if (!active) return;
      setAnnouncement(value);
      if (!remote(value)) return;
      // 勾选发生在公告加载前：免打扰绑定到实际加载出的这一版。
      if (mutedHere.current) { saveNoticePreference(true, new Date(), undefined, value.version); return; }
      // 今天免打扰的是另一版公告：新公告照常弹出一次（须知当天已看过，只弹公告）。
      if (initialMute?.version !== undefined && initialMute.version !== value.version)
        setState(current => current.kind ? current : { kind: 'announcement', automatic: true, muted: false });
    });
    return () => { active = false; };
  }, [initialMute]);
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
    mutedHere.current = muted;
    saveNoticePreference(muted, new Date(), undefined, announcement.version);
    setState(current => ({ ...current, muted }));
  }
  function open(kind: NoticeKind) {
    setState({ kind, automatic: false, muted: noticesMutedFor(announcement.version) });
  }
  return { ...state, announcement, close, setMuted, open };
}
