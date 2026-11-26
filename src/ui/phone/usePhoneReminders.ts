import { useEffect, useMemo, useReducer } from 'react';
import type { GameState } from '../../domain/state';
import { loanReminderDays, upcomingLoans } from './phoneView';

const prefix = 'heijin.phone.loan-read.v1:';
const volatileReads = new Set<string>();
const changed = 'heijin-phone-read';

function seen(key: string) {
  try {
    return volatileReads.has(key) || localStorage.getItem(prefix + key) === '1';
  } catch {
    return volatileReads.has(key);
  }
}

export function usePhoneReminders(state: GameState) {
  const loans = useMemo(() => upcomingLoans(state), [state]);
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const storage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith(prefix)) refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(changed, refresh);
    };
  }, []);
  const reminders = loans.filter((row) => row.days <= loanReminderDays);
  return {
    loans,
    reminders,
    unread: reminders.filter((row) => !seen(row.key)),
    markRead(key: string) {
      try {
        localStorage.setItem(prefix + key, '1');
      } catch {
        volatileReads.add(key);
      }
      window.dispatchEvent(new Event(changed));
    },
  };
}
