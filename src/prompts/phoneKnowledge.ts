import { isPrivate, type PhoneOperation } from '../domain/phoneChat';
import { groupLabel, type GroupExchange } from '../domain/phoneGroup';

// Exchange order, including the order of its receipts, is authoritative even at identical game times.
export function groupTranscript(row: GroupExchange) {
  const { action, at, outcomes } = row;
  const unread = new Set(outcomes.filter((o) => o.status === 'unread').map((o) => o.npcId));
  const members = new Set(
    row.audience.filter((id) => !('invitees' in action && action.invitees.includes(id))),
  );
  function line(
    id: string,
    sender: string,
    text: string,
    kind: string,
    audience: string[],
    action?: GroupExchange['action'],
  ) {
    return {
      id,
      at,
      sender,
      text,
      kind,
      audience,
      action,
      readers: audience.filter((id) => !unread.has(id)),
    };
  }
  const lines = [
    line(
      row.id,
      'protagonist',
      groupLabel(action),
      action.type,
      row.audience,
      action.type === 'message' ? undefined : action,
    ),
  ];
  for (const [i, outcome] of outcomes.entries()) {
    const { npcId, status } = outcome;
    if (status === 'joined') members.add(npcId);
    const audience = status === 'refused' ? [...members, npcId] : [...members];
    lines.push(
      line(row.id + ':' + i, npcId, status === 'replied' ? outcome.text : status, status, audience),
    );
    if (status === 'left') members.delete(npcId);
  }
  return lines;
}

export function publicGroupLine(line: ReturnType<typeof groupTranscript>[number]) {
  return line.kind !== 'unread' && line.kind !== 'later' && line.kind !== 'read_unanswered';
}

export function personalTurnHistory(rows: readonly PhoneOperation[], npcId: string) {
  type Entry = {
    conversation: { kind: 'private' | 'group'; id: string };
    participants: string[];
    id: string;
    at: string;
    sender: string;
    text: string;
    status: string;
  };
  const entries: Entry[] = [];
  for (const row of rows) {
    if (isPrivate(row)) {
      const { reply } = row;
      if (reply.npcId !== npcId || reply.status === 'unread') continue;
      const common = {
        conversation: { kind: 'private' as const, id: npcId },
        participants: ['protagonist', npcId],
        at: row.at,
      };
      entries.push({
        ...common,
        id: row.id,
        sender: 'protagonist',
        text: row.text,
        status: reply.status,
      });
      if (reply.status === 'replied')
        entries.push({
          ...common,
          id: row.id + ':reply',
          sender: npcId,
          text: reply.text,
          status: 'replied',
        });
    } else if (row.audience.includes(npcId)) {
      const receipt = row.outcomes.find((o) => o.npcId === npcId)?.status;
      for (const line of groupTranscript(row).filter(publicGroupLine)) {
        if (line.readers.includes(npcId))
          entries.push({
            conversation: { kind: 'group', id: row.groupId },
            participants: ['protagonist', ...line.audience],
            id: line.id,
            at: line.at,
            sender: line.sender,
            text: line.text,
            status:
              line.id === row.id ? (receipt ?? 'read') : line.sender === npcId ? line.kind : 'read',
          });
      }
    }
  }
  return entries;
}
