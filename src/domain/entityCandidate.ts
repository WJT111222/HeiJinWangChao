import { requireData } from './common';
import { projectEntityChanges, type DomainCommand } from './commands';
import type { TurnDraft } from './drafts';
import type { GameState } from './state';
import { commandsForPhase } from './stageCommands';
import { openingTimeSelection } from './openingTime';

export function contactIds(state: GameState, declared: readonly string[]) {
  return new Set([...Object.values(state.npc).filter(person => person.onScene).map(person => person.id), ...declared]);
}

export function checkEntityCommands(state: GameState, draft: TurnDraft, declared: readonly string[], commands: readonly DomainCommand[]) {
  const ids = contactIds(state, declared);
  const allowed = new Set(commandsForPhase('entities', draft.turnKind));
  const people = new Set(Object.keys(state.npc));
  for (const command of commands)
    requireData(allowed.has(command.type), 'STAGE_PERMISSION', '人物与实体阶段命令越权');
  const entities = commands.length ? projectEntityChanges(state, draft.turnId, commands) : state;
  const checkPerson = (id: string) => requireData(Object.hasOwn(entities.npc, id), 'NOT_FOUND', '人物引用不存在');
  const checkLocation = (id: string) => requireData(Object.hasOwn(entities.locations, id), 'NOT_FOUND', '地点引用不存在');
  requireData(new Set(commands.map(command => command.commandId)).size === commands.length, 'DUPLICATE_COMMAND', '候选命令 ID 重复');
  for (const command of commands) {
    if (command.type === 'CreateNpc') {
      requireData(!people.has(command.npc.id), 'DUPLICATE_ID', '新建人物 ID 重复');
      people.add(command.npc.id);
      requireData(ids.has(command.npc.id), 'STAGE_PERMISSION', '新人物须列入本回合接触名单');
    } else if ('npcId' in command) {
      requireData(people.has(command.npcId) && ids.has(command.npcId), 'STAGE_PERMISSION', '人物引用或接触名单无效');
    }
    if (command.type === 'CreateNpc') {
      const person = entities.npc[command.npc.id];
      person.usualLocations?.forEach(ref => checkLocation(ref.locationId));
      if (person.kind === 'special') {
        person.relationshipNetwork?.forEach(ref => { if (ref.npcId) checkPerson(ref.npcId); });
        for (const id of person.offscreenTaskIds) {
          const actor = state.tasks[id]?.actorRef;
          requireData(actor?.kind === 'npc' && actor.id === command.npc.id, 'NOT_FOUND', '场外任务引用或归属无效');
        }
      }
      if (command.npc.locationId) checkLocation(command.npc.locationId);
    }
    if (command.type === 'CreateLocation') {
      const seen = new Set([command.location.id]);
      let parent = command.location.parentId;
      while (parent) {
        checkLocation(parent);
        requireData(!seen.has(parent), 'LOCATION_CYCLE', '地点层级存在环');
        seen.add(parent);
        parent = entities.locations[parent].parentId;
      }
    }
    if (command.type === 'CreateOrganization') {
      const org = command.organization;
      org.keyNpcIds.forEach(checkPerson);
      const departments = new Set(org.departments?.map(department => department.id));
      org.departments?.forEach(department => { if (department.headNpcId) checkPerson(department.headNpcId); });
      org.members?.forEach(member => {
        checkPerson(member.npcId);
        requireData(!member.departmentId || departments.has(member.departmentId), 'NOT_FOUND', '成员所属部门不存在');
      });
      for (const id of org.currentTaskIds) {
        const actor = state.tasks[id]?.actorRef;
        requireData(actor?.kind === 'organization' && actor.id === org.id, 'NOT_FOUND', '组织任务引用或归属无效');
      }
      org.leadership?.forEach(leader => { if (leader.npcId) checkPerson(leader.npcId); });
      org.relations?.forEach(ref => requireData(ref.organizationId !== org.id && Object.hasOwn(entities.organizations, ref.organizationId), 'NOT_FOUND', '组织引用不存在'));
    }
    if (command.type === 'UpdateNpc') {
      if (command.changes.locationId) checkLocation(command.changes.locationId);
      command.changes.usualLocations?.forEach(ref => checkLocation(ref.locationId));
      command.changes.relationshipNetwork?.forEach(ref => { if (ref.npcId) checkPerson(ref.npcId); });
    }
    if (command.type === 'ApplyHaremChanges') for (const edit of command.changes) {
      if ('npcId' in edit) checkPerson(edit.npcId);
      if (edit.op === 'pair') { checkPerson(edit.value.leftNpcId); checkPerson(edit.value.rightNpcId); }
      if (edit.op === 'child') { checkPerson(edit.value.parentNpcId); checkPerson(edit.value.childNpcId); }
      if (edit.op === 'discloseChild') checkPerson(edit.childNpcId);
    }
  }
  for (const id of declared) requireData(people.has(id), 'NOT_FOUND', '接触名单中的人物不存在');
  return entities;
}

export function sceneAndEntityCommands(state: GameState, draft: TurnDraft, scene: readonly DomainCommand[]) {
  if (!draft.entities) return [...scene];
  const { result, contactedNpcIds } = draft.entities;
  checkEntityCommands(state, draft, contactedNpcIds, result.commands);
  const created = new Map(result.commands.flatMap(command => command.type === 'CreateOrganization'
    ? [[command.organization.id, command.organization] as const] : []));
  for (const command of scene) {
    if (command.type === 'UpdateOrganization') {
      const initial = created.get(command.organizationId);
      requireData(!initial || Object.keys(command.changes).every(field => !Object.hasOwn(initial, field)),
        'STAGE_PERMISSION', '现场阶段不能覆盖本回合新组织已写入的字段');
    }
    if (command.type === 'RecordOrgRelation' && created.has(command.organizationId))
      requireData(!Object.hasOwn(created.get(command.organizationId)!, 'protagonistRelation'),
        'STAGE_PERMISSION', '现场阶段不能覆盖本回合新组织已记录的主角关系');
  }
  const clocks = scene.filter(c => c.type === 'SetWorldClock');
  const clock = clocks.at(-1)?.worldClock ?? openingTimeSelection(state, draft, scene)?.endAt ?? state.worldClock;
  const entities = result.commands.map(command => {
    if (command.type === 'CreateNpc' && command.npc.lastInteractionAt)
      requireData(Date.parse(command.npc.lastInteractionAt) <= Date.parse(clock), 'NPC_TIME', '新人物互动时间超出本回合');
    if (command.type !== 'RecordNpcMemory') return command;
    requireData(Date.parse(command.memory.createdAtGameTime) <= Date.parse(clock), 'NPC_TIME', '人物记忆时间超出本回合');
    return { ...command, memory: { ...command.memory, createdAtGameTime: clock } };
  });
  return [...clocks, ...entities, ...scene.filter(c => c.type !== 'SetWorldClock')];
}
