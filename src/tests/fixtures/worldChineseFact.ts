import type { DomainCommand } from '../../domain/commands';
import { TurnDraftSchema } from '../../domain/drafts';
import { GameStateSchema } from '../../domain/state';
import { organizationBase } from './game';
import { worldDraft, worldResult, worldState } from './world';

// Only this evidence object is user-provided. No full response or original save was supplied.
export const schoolEvidence = {
  version: 1,
  kind: 'derived',
  at: '2026-10-20T06:48:23.480Z',
  sources: ['story:current', 'org:org_school_38th'],
  fact: '三十八中管理层在校内排查教学秩序与食堂账目，力保早自习后督导暗访迎检准备落实到位。',
  rationale: '正文中周琴与张主任均提及督导组即将暗访食堂与收费账目，管理层正在采取措施维护迎检秩序。',
} as const;

// Synthetic, schema-valid context. These dates, task fields and narrative are NOT recovered data.
export function schoolContext() {
  const state = GameStateSchema.parse({ ...worldState(), worldClock: '2026-10-20T06:38:23.480Z',
    organizations: { org_school_38th: { ...organizationBase, id: 'org_school_38th', name: '三十八中',
      kind: 'government', lawfulPowers: ['校内教学与食堂管理'], cases: [], administrativeAffairs: [] } },
  });
  const original = worldDraft();
  const draft = TurnDraftSchema.parse({ ...original, story: { ...original.story,
    narrative: '周琴与张主任提及督导组即将暗访食堂与收费账目。管理层正在校内排查账目。' },
    variables: { ...original.variables, result: { commands: [{ type: 'SetWorldClock', commandId: 'clock',
      worldClock: schoolEvidence.at, evidence: '本轮实际活动耗时' }], rejectedSuggestions: [], unresolved: [] } },
  });
  return { state, draft };
}
export function schoolTask(fact: string = schoolEvidence.fact): Extract<DomainCommand, { type: 'SaveTask' }> {
  return { type: 'SaveTask', commandId: 'school-task', evidence: JSON.stringify({ ...schoolEvidence, fact }),
    task: { id: 'task_school_inspection', actorRef: { kind: 'organization', id: 'org_school_38th' },
      goal: '排查教学秩序和食堂账目，开展迎检准备工作', startAt: '2026-10-20T06:40:00.000Z',
      dueAt: '2026-10-20T08:00:00.000Z', completionCondition: '完成本轮校内排查并整理清单',
      status: 'active', prerequisites: [], blockers: [] } };
}
export const schoolResult = (command = schoolTask()) => ({ ...worldResult(), taskCommands: [command], visibleHooks: [], unresolved: [] });

// Two independently synthesized events for integration coverage, NOT the missing real SaveEvent objects.
export function syntheticSchoolBatch() {
  const result = schoolResult();
  return { ...result, eventCommands: [
    { type: 'SaveEvent' as const, commandId: 'school-accounts', evidence: JSON.stringify({ ...schoolEvidence,
      fact: '财务部门正在排查账目。' }), event: { id: 'school_accounts', title: '食堂账目排查', status: 'active' as const,
      backgroundText: '迎检期间正在核查账目', goalText: '核对账目记录', startAt: '2026-10-20T06:42:00.000Z',
      estimatedEndAt: '2026-10-20T08:00:00.000Z', actorRefs: [schoolTask().task.actorRef],
      linkedTaskIds: [], prerequisites: [], blockers: [], visibility: 'hidden' as const, impact: 'minor' as const,
      sourceTurnIds: ['turn-a'] } },
    { type: 'SaveEvent' as const, commandId: 'school-inspection', evidence: JSON.stringify({ ...schoolEvidence,
      kind: 'planned', fact: '学校计划稍后复核食堂检查清单。' }), event: { id: 'school_inspection', title: '检查清单复核',
      status: 'scheduled' as const, backgroundText: '排查结束后复核清单', goalText: '完成清单复核',
      startAt: '2026-10-20T07:00:00.000Z', estimatedEndAt: '2026-10-20T09:00:00.000Z', actorRefs: [schoolTask().task.actorRef],
      linkedTaskIds: [], prerequisites: [], blockers: [], visibility: 'hidden' as const, impact: 'minor' as const,
      sourceTurnIds: ['turn-a'] } },
  ] };
}
