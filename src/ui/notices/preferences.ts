export const noticeDateKey = 'heijin.notices.hidden-on.v1';

type NoticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageAccess = () => NoticeStorage;
const browserStorage: StorageAccess = () => window.localStorage;

// 免打扰是设备本地日历日，与世界时钟和 UTC 日期无关。
export function localNoticeDate(now: Date): string {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}

export function noticesMutedToday(now = new Date(), storage: StorageAccess = browserStorage): boolean {
  try {
    return storage().getItem(noticeDateKey) === localNoticeDate(now);
  } catch {
    return false;
  }
}

export function saveNoticePreference(muted: boolean, now = new Date(), storage: StorageAccess = browserStorage): void {
  try {
    if (muted) storage().setItem(noticeDateKey, localNoticeDate(now));
    else storage().removeItem(noticeDateKey);
  } catch {
    // 仅为便利偏好：浏览器拒绝存储时，当前弹窗仍可正常关闭和继续。
  }
}
