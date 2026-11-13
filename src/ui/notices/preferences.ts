export const noticeDateKey = 'heijin.notices.hidden-on.v1';
/** 勾选「今日不再弹出」时看到的公告版本。缺省（旧记录）表示当天对所有版本免打扰。 */
export const noticeVersionKey = 'heijin.notices.hidden-version.v1';

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

/** 当天的免打扰记录；没有或不是今天时返回 undefined。version 缺省表示旧记录，对所有版本生效。 */
export function noticeMuteToday(now = new Date(), storage: StorageAccess = browserStorage): { version?: string } | undefined {
  try {
    if (storage().getItem(noticeDateKey) !== localNoticeDate(now)) return undefined;
    const version = storage().getItem(noticeVersionKey);
    return version ? { version } : {};
  } catch {
    return undefined;
  }
}

/** 今天是否已对这一版公告免打扰：同一天发布了新版本，仍要弹出。 */
export function noticesMutedFor(version: string, now = new Date(), storage: StorageAccess = browserStorage): boolean {
  const mute = noticeMuteToday(now, storage);
  return mute !== undefined && (mute.version === undefined || mute.version === version);
}

export function saveNoticePreference(muted: boolean, now = new Date(), storage: StorageAccess = browserStorage, version?: string): void {
  try {
    if (muted) {
      storage().setItem(noticeDateKey, localNoticeDate(now));
      if (version) storage().setItem(noticeVersionKey, version);
      else storage().removeItem(noticeVersionKey);
    } else {
      storage().removeItem(noticeDateKey);
      storage().removeItem(noticeVersionKey);
    }
  } catch {
    // 仅为便利偏好：浏览器拒绝存储时，当前弹窗仍可正常关闭和继续。
  }
}
