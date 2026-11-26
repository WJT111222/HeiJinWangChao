// Only the notification crosses tabs. IndexedDB is the authoritative source on every refresh.
const changeKey = 'heijin.worldbooks.changed';
export function announceWorldbookChange() {
  window.dispatchEvent(new Event(changeKey));
  try { localStorage.setItem(changeKey, crypto.randomUUID()); } catch { /* focus still refreshes */ }
}
export function watchWorldbookChanges(refresh: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === changeKey) refresh(); };
  window.addEventListener(changeKey, refresh);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', refresh);
  return () => {
    window.removeEventListener(changeKey, refresh);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', refresh);
  };
}
