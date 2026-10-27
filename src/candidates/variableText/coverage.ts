import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { DomainCommand } from '../../domain/commands';
import { selectVariableDomains, assertVariableCoverage } from '../../prompts/variableDomains';
import { TextCoverageSchema } from './model';
import type { TextCoverage } from './model';

export function assessTextVariableCoverage(state: GameState, draft: TurnDraft, commands: readonly DomainCommand[]): TextCoverage {
  // 旧选择器只是规则模块范围；其词法线索不作为事实来源或完整性证明。
  const selected = selectVariableDomains(state, draft);
  assertVariableCoverage(selected.domains, state, commands);
  const represented = new Set<string>();
  for (const c of commands) {
    if (c.type === 'UpdateProtagonist') represented.add('protagonist');
    if (c.type === 'UpdateNpc') represented.add(state.npc[c.npcId]?.kind === 'special' ? 'npc_special' : 'npc_ordinary');
  }
  const unsupported: number[] = [];
  for (const [i, guide] of (draft.story?.variableGuide ?? []).entries()) {
    if (['economy', 'items', 'organization', 'event'].includes(guide.group)
      || (guide.group === 'time' && !(state.openingTimePending && guide.subjectHint === 'time:opening'))) unsupported.push(i);
  }
  return TextCoverageSchema.parse({ complete: false, status: unsupported.length ? 'unsupported_hints' : commands.length ? 'scope_unconfirmed' : 'empty_unconfirmed',
    ruleDomains: selected.domains, representedDomains: [...represented], unsupportedGuideIndices: unsupported });
}
