import type { WorldEvent } from './schema';

type EventKnowledgeInput = Pick<WorldEvent, 'id' | 'title' | 'startAt' | 'status' | 'resolutionText' | 'visibility' | 'sourceTurnIds' | 'protagonistKnowledge'>;
export function hasUnobservedEventProgress(event: EventKnowledgeInput) {
  return Boolean(event.protagonistKnowledge && (event.visibility !== 'known'
    || event.sourceTurnIds.at(-1) === event.protagonistKnowledge.worldUpdateTurnId));
}
/** 只给Story使用；玩家观察仍读取完整客观记录。旧档缺字段沿用原known语义。 */
export function protagonistKnownEvent(event: EventKnowledgeInput) {
  const snapshot = event.protagonistKnowledge;
  if (snapshot && hasUnobservedEventProgress(event)) return {
    id: event.id, title: snapshot.title, startAt: snapshot.startAt,
    status: snapshot.status, resolutionText: snapshot.resolutionText,
    ...(snapshot.notice ? { notice: snapshot.notice, knowledgeKind: snapshot.knowledgeKind } : {}),
  };
  if (event.visibility !== 'known') return undefined;
  // 后续Variables现场更新会追加新turnId，表示本幕Story已经实际呈现的状态。
  // Variables不能改标题，保留此前已知标题，避免公开World私下更改的描述。
  return { id: event.id, title: snapshot?.title ?? event.title, startAt: event.startAt,
    status: event.status, resolutionText: event.resolutionText };
}
