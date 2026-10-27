import { TextSchema } from '../../domain/common';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { DomainCommand } from '../../domain/commands';
import { openingTimeSelection } from '../../domain/openingTime';
import { validateTimeCommands } from '../../domain/timePreflight';
import { variablePermission } from '../../services/validation/evidence';
import { parseVariablePath } from '../../parsers/variableText';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import type { VariableExecutionContext } from '../../executors/variableText';
import { candidateFailure, TextInstructionSchema } from './model';
import type { CandidateResult, TextInstruction, TextVariableRequestBasis, TextAccess, ClockSource } from './model';

export function normalizeTextInstructions(ast: readonly ParsedVariableCommand[]): CandidateResult<TextInstruction[]> {
  const output: TextInstruction[] = [];
  for (let i = 0; i < ast.length; i++) {
    const c = ast[i], [root, middle, last] = c.path.nodes;
    const deny = (code: Parameters<typeof candidateFailure>[0]) => candidateFailure(code, i + 1, c.source);
    if (root.name === 'economy' || root.name === 'items' || (root.name === 'npc' && last?.kind === 'field' && last.name === 'memories')) return deny('missing_provenance');
    if (c.operation !== 'set') return deny('unsupported_operation');
    const allowed = (c.path.nodes.length === 2 && root.name === 'protagonist' && middle?.kind === 'field' && ['healthText', 'emotionText'].includes(middle.name))
      || (c.path.nodes.length === 3 && root.name === 'npc' && middle?.kind === 'id' && last?.kind === 'field' && ['healthText', 'relationshipText'].includes(last.name));
    if (!allowed) return deny('unsupported_path');
    const value = TextSchema.max(8192).safeParse(c.value);
    if (!value.success) return deny('type_mismatch');
    if (c.path.nodes.length === 2 && root.name === 'protagonist' && middle?.kind === 'field'
      && (middle.name === 'healthText' || middle.name === 'emotionText')) {
      output.push({ operation: 'set', target: { kind: 'protagonist', field: middle.name }, value: value.data, source: c.source });
    } else if (c.path.nodes.length === 3 && root.name === 'npc' && middle?.kind === 'id' && last?.kind === 'field'
      && (last.name === 'healthText' || last.name === 'relationshipText')) {
      const parsed = TextInstructionSchema.safeParse({ operation: 'set', target: { kind: 'npc', npcId: middle.id, field: last.name }, value: value.data, source: c.source });
      if (!parsed.success) return deny('unsupported_path');
      output.push(parsed.data);
    } else return deny('unsupported_path');
  }
  return { ok: true, value: output };
}
/** 同步重建仅限四种文本提案；不赋值状态，不推断付款/目击，不复制通用执行器。 */
export function deriveTextCommands(instructions: readonly TextInstruction[], state: GameState, draft: TurnDraft,
  request: TextVariableRequestBasis): CandidateResult<{ commands: DomainCommand[]; accesses: TextAccess[]; ast: ParsedVariableCommand[]; context: VariableExecutionContext }> {
  const commands: DomainCommand[] = [], accesses: TextAccess[] = [], ast: ParsedVariableCommand[] = [];
  const context: VariableExecutionContext = { draft, expectedRevision: state.revision, interactions: [], proofs: [] };
  for (let i = 0; i < instructions.length; i++) {
    const c = instructions[i], target = c.target;
    const deny = (code: Parameters<typeof candidateFailure>[0]) => candidateFailure(code, i + 1, c.source);
    if (c.source.end.offset < c.source.start.offset || c.source.end.line < c.source.start.line) return deny('type_mismatch');
    const path = parseVariablePath(target.kind === 'protagonist' ? `protagonist.${target.field}` : `npc[${target.npcId}].${target.field}`);
    if (!path.ok) return deny('unsupported_path');
    ast.push({ operation: 'set', path: path.value, value: c.value, source: c.source });
    const evidence = `text-v1:state-access:${draft.turnId}:story${draft.storyRevision}:request${request.requestRevision}:command${i + 1}`;
    const common = { commandId: `text-v1:s${draft.storyRevision}:c${i + 1}`, evidence, expectedRevision: state.revision };
    let command: DomainCommand;
    if (target.kind === 'protagonist') {
      accesses.push({ kind: 'protagonist_text_access', commandIndex: i + 1, protagonistId: state.protagonist.id, field: target.field });
      command = { ...common, type: 'UpdateProtagonist', protagonistId: state.protagonist.id,
        changes: target.field === 'healthText' ? { healthText: c.value } : { emotionText: c.value } };
    } else {
      if (!Object.hasOwn(state.npc, target.npcId)) return deny('entity_not_found');
      const npc = state.npc[target.npcId];
      if (!npc.onScene || !npc.locationId || npc.locationId !== state.protagonist.locationId) return deny('permission_denied');
      accesses.push({ kind: 'npc_scene_text_access', commandIndex: i + 1, npcId: npc.id, identityKey: npc.identityKey, locationId: npc.locationId, field: target.field });
      command = { ...common, type: 'UpdateNpc', npcId: npc.id,
        changes: target.field === 'healthText' ? { healthText: c.value } : { relationshipText: c.value } };
    }
    try { variablePermission(command, state, draft); } catch { return deny('permission_denied'); }
    context.proofs.push({ commandIndex: i + 1, evidence }); commands.push(command);
  }
  try { validateTimeCommands(state, draft, commands); } catch { return candidateFailure('time_data'); }
  return { ok: true, value: { commands, accesses, ast, context } };
}
export function candidateClock(state: GameState, draft: TurnDraft): CandidateResult<ClockSource> {
  try {
    const opening = openingTimeSelection(state, draft);
    return { ok: true, value: opening ? { kind: 'opening_story', storyRevision: draft.storyRevision, startAt: opening.startAt, endAt: opening.endAt }
      : { kind: 'established', worldClock: state.worldClock } };
  } catch { return candidateFailure('time_data'); }
}
