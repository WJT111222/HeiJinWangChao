import { z } from 'zod';
import { CommandDataError } from '../../domain/common';
import type { DomainCommand } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { preparedVariableCommands, variableCommandsForTurn } from '../../domain/turnProjection';
import { safeWorldPath, worldValidationError } from './worldDiagnostics';

type WorldResult = NonNullable<TurnDraft['world']>['result'];
// Map actual execution indices / structured state paths back to original output positions.
// Never guess an index for an unattributable batch constraint; never emit entity-key strings.
export function worldProjectionError(error: unknown, result: WorldResult, state: GameState, draft: TurnDraft) {
  const entries = (['worldCommands','taskCommands','eventCommands'] as const).flatMap(group =>
    result[group].map((command, index) => ({ command, fieldPath:`${group}.${index}` })));
  const scope = (index: number) => ({fieldPath:entries[index].fieldPath,commandIndex:index,commandType:entries[index].command.type});
  if (error instanceof CommandDataError) {
    const variables = draft.variables?.validation === 'validated'
      ? preparedVariableCommands(state,draft,draft.variables.result.commands) : variableCommandsForTurn(state,draft,[]);
    const index = error.commandIndex - variables.length;
    if (entries[index]) return worldValidationError(error,scope(index));
  }
  if (error instanceof z.ZodError) {
    const path = error.issues[0]?.path ?? [], [table, id, ...rest] = path;
    function target(c: DomainCommand): [string, string, string] | undefined {
      switch(c.type) {
        case 'CreateLocation': return ['locations',c.location.id,'location'];
        case 'CreateNpc': return ['npc',c.npc.id,'npc'];
        case 'UpdateNpc': return Object.hasOwn(c.changes,String(rest[0])) ? ['npc',c.npcId,'changes'] : undefined;
        case 'SaveTask': return ['tasks',c.task.id,'task'];
        case 'SaveEvent': return ['events',c.event.id,'event'];
        case 'UpdateOrganization': return ['organizations',c.organizationId,'changes'];
        case 'CreateOrganization': return ['organizations',c.organization.id,'organization'];
      }
    }
    // Last writer owns the final field in the projection. Existing records without a writer stay batch errors.
    for(let index=entries.length-1;index>=0;index--) {
      const entry=entries[index], mapped=target(entry.command);
      const history = table==='timeline' && typeof id==='number' && entry.command.type==='RecordHistory'
        && entries.filter(e=>e.command.type==='RecordHistory').indexOf(entry)===id-state.timeline.length;
      if ((mapped && mapped[0]===table && mapped[1]===id) || history) {
        const relative=[history?'entry':mapped![2],...rest];
        return worldValidationError(new z.ZodError(error.issues.map((issue,i)=>i===0?{...issue,path:relative}:issue)),scope(index));
      }
    }
    return worldValidationError(new z.ZodError(error.issues.map(issue=>({...issue,path:[]}))),
      {fieldPath:`state${path.length?`.${safeWorldPath(path.map((part,index)=>index===1 && typeof part==='string'?'field':part))}`:''}`});
  }
  return worldValidationError(error,{fieldPath:'state'});
}
