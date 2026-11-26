import { fingerprint } from '../../domain/commands';
import type { z } from 'zod';
import type { TurnDraft, WorldResultSchema } from '../../domain/drafts';
import type { GameState } from '../../domain/state';

/**
 * World 与本轮已验证 Variables 写入同一对象时的处理（Issue #186）：
 * Variables 直接依据正文，以它为准；World 同名字段由程序剔除，不再让整个 World 阶段失败。
 * - UpdateOrganization：去掉 Variables 本轮 UpdateOrganization 改过、或 CreateOrganization 新建时已有的字段；
 * - UpdateNpc（人物在场时）：去掉 Variables 本轮 UpdateNpc 改过的字段；
 * - RecordOrgRelation：Variables 本轮已记录该组织关系或新建该组织时，整条忽略。
 * 剔除后没有剩余内容的命令整条忽略。处理说明只进入本页诊断（模型原文页），不写存档。
 * 剔除后的结果会原样保存；提交时的重验不会再遇到冲突，结果稳定。
 */
export const worldNormalizationNotes = new WeakMap<object, readonly string[]>();

type WorldResult = z.infer<typeof WorldResultSchema>;
/** World 无权写入的人物字段（身份、关系、互动、重新入场）。这些字段不剔除，留给权限校验直接拒绝，避免冲突处理掩盖越权。 */
const worldForbiddenNpcFields = ['name','aliases','identity','addressing','phoneContact','appearedInStory','usualLocations','detailedBackground','habits','relationshipNetwork','relationshipText','lastInteractionAt'];
export function worldForbiddenNpcChange(key: string, value: unknown) {
  return worldForbiddenNpcFields.includes(key) || key === 'onScene' && value === true;
}
const moneyFields = ['funds', 'assetsEstimate', 'liquidityEstimate'];

function describe(command: string, id: string, same: string[], changed: string[], dropped: boolean) {
  const fields = [...same, ...changed].join('、');
  const detail = changed.length ? `（其中 ${changed.join('、')} 的值与变量阶段不同，以变量阶段为准）` : '（值与变量阶段相同）';
  return `${command}（${id}）：字段 ${fields} 已由本轮变量阶段写入，动态世界的同名字段已忽略${detail}${dropped ? '；该命令没有剩余内容，整条忽略' : ''}。`;
}

/** 原始候选已通过权限和领域校验后，仅剔除合法 worldCommands 的冲突字段。 */
export function stripVariableSceneWrites(result: WorldResult, state: GameState, draft: TurnDraft): string[] {
  const prior = [...(draft.entities?.result.commands ?? []),
    ...(draft.variables?.validation === 'validated' ? draft.variables.result.commands : [])];
  if (!prior.length) return [];
  const orgWrites = new Map<string, Map<string, unknown>>(), npcWrites = new Map<string, Map<string, unknown>>();
  const relationOrgs = new Set<string>();
  const remember = (map: Map<string, Map<string, unknown>>, id: string, entries: [string, unknown][]) => {
    const fields = map.get(id) ?? new Map<string, unknown>();
    for (const [key, value] of entries) fields.set(key, value);
    map.set(id, fields);
  };
  for (const c of prior) {
    if (c.type === 'CreateOrganization') {
      remember(orgWrites, c.organization.id, Object.entries(c.organization));
      relationOrgs.add(c.organization.id);
    }
    if (c.type === 'UpdateOrganization') remember(orgWrites, c.organizationId, Object.entries(c.changes));
    if (c.type === 'RecordOrgRelation') relationOrgs.add(c.organizationId);
    if (c.type === 'UpdateNpc') remember(npcWrites, c.npcId, Object.entries(c.changes));
  }
  const notes: string[] = [];
  const strip = (changes: Record<string, unknown>, written: Map<string, unknown> | undefined, forbidden: (key: string, value: unknown) => boolean = () => false) => {
    const same: string[] = [], changed: string[] = [];
    for (const key of Object.keys(changes)) {
      if (!written?.has(key) || forbidden(key, changes[key])) continue;
      (fingerprint(written.get(key)) === fingerprint(changes[key]) ? same : changed).push(key);
      delete changes[key];
    }
    return { same, changed };
  };
  const keep = (command: WorldResult['worldCommands'][number]) => {
    if (command.type === 'UpdateOrganization') {
      const { same, changed } = strip(command.changes as Record<string, unknown>, orgWrites.get(command.organizationId));
      if (!same.length && !changed.length) return true;
      if (command.financialBasis && !moneyFields.some((key) => Object.hasOwn(command.changes, key))) delete command.financialBasis;
      const dropped = Object.keys(command.changes).length === 0;
      notes.push(describe('UpdateOrganization', command.organizationId, same, changed, dropped));
      return !dropped;
    }
    if (command.type === 'UpdateNpc' && state.npc[command.npcId]?.onScene) {
      const { same, changed } = strip(command.changes as Record<string, unknown>, npcWrites.get(command.npcId), worldForbiddenNpcChange);
      if (!same.length && !changed.length) return true;
      const dropped = Object.keys(command.changes).length === 0 && !command.affinityChange && !command.activeGoals;
      notes.push(describe('UpdateNpc', command.npcId, same, changed, dropped));
      return !dropped;
    }
    if (command.type === 'RecordOrgRelation' && relationOrgs.has(command.organizationId)) {
      notes.push(`RecordOrgRelation（${command.organizationId}）：本轮变量阶段已记录该组织与主角的关系，动态世界的关系记录整条忽略，以变量阶段为准。`);
      return false;
    }
    return true;
  };
  result.worldCommands = result.worldCommands.filter(keep);
  return notes;
}

/** Full-record task/event saves must preserve fields actually changed on an existing record, or established when a record was created. */
export function conflictingSceneField<T extends Record<string, unknown>>(formal: T | undefined, scene: T | undefined, world: T) {
  if (!scene) return undefined;
  return [...new Set([...Object.keys(formal ?? {}), ...Object.keys(scene)])].find(key =>
    key !== 'sourceTurnIds' && (!formal || fingerprint(formal[key]) !== fingerprint(scene[key])) && fingerprint(world[key]) !== fingerprint(scene[key]));
}

/** Keep a field protected even when a later scene command restores its original value. */
export function sceneEventWriteFields(state: GameState, draft: TurnDraft) {
  const fields = new Map<string, Set<string>>();
  const previous = new Map(Object.entries(state.events));
  for (const command of draft.variables?.result.commands ?? []) {
    if (command.type !== 'SaveEvent') continue;
    const event = command.event, prior = previous.get(event.id);
    const written = fields.get(event.id) ?? new Set<string>();
    for (const key of new Set([...Object.keys(prior ?? {}), ...Object.keys(event)])) {
      if (key !== 'sourceTurnIds' && (!prior || fingerprint(Reflect.get(prior,key)) !== fingerprint(Reflect.get(event,key)))) written.add(key);
    }
    fields.set(event.id, written);
    previous.set(event.id, event);
  }
  return fields;
}
