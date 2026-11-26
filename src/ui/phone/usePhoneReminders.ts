import { useEffect, useMemo, useReducer } from 'react';
import type { GameState } from '../../domain/state';
import { loanReminderDays, upcomingLoans } from './phoneView';

const prefix = 'heijin.phone.loan-read.v1:';
const messagePrefix = 'heijin.phone.message-read.v1:';
const volatileReads = new Set<string>();
const changed = 'heijin-phone-read';

function seen(key: string) {
  try {
    return volatileReads.has(key) || localStorage.getItem(key) === '1';
  } catch {
    return volatileReads.has(key);
  }
}

export function usePhoneReminders(state: GameState) {
  const loans = useMemo(() => upcomingLoans(state), [state]);
  const messages = useMemo(
    () =>
      Object.values(state.phone.threads)
        .flatMap((thread) =>
          thread.messages
            .filter((message) => message.sender === 'npc' && message.source !== 'chat')
            .map((message) => ({
              npcId: thread.npcId,
              message,
              key:
                messagePrefix +
                JSON.stringify([
                  state.saveId,
                  state.createdAt,
                  thread.npcId,
                  message.id,
                  message.sourceTurnId,
                  message.deliveredTurnId,
                ]),
            })),
        )
        .sort((a, b) => Date.parse(b.message.at) - Date.parse(a.message.at)),
    [state],
  );
  const [readVersion, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const storage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith(prefix) || e.key.startsWith(messagePrefix)) refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(changed, refresh);
    };
  }, []);
  const reminders = loans.filter((row) => row.days <= loanReminderDays);
  const unread = reminders.filter((row) => !seen(prefix + row.key));
  // Storage events invalidate the local read index even when the formal save is unchanged.
  const unreadMessages = useMemo(() => messages.filter(row => !seen(row.key)), [messages, readVersion]);
  return {
    messages,
    unreadMessages,
    unread,
    unreadCount: unreadMessages.length + unread.length,
    loans,
    reminders,
    markRead(...keys: string[]) {
      for (const id of keys) {
        const key = id.startsWith(messagePrefix) ? id : prefix + id;
        try {
          localStorage.setItem(key, '1');
        } catch {
          volatileReads.add(key);
        }
      }
      window.dispatchEvent(new Event(changed));
    },
  };
}
