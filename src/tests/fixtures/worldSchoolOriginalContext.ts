import original from './world-school-original.json';
import { GameStateSchema } from '../../domain/state';
import { TurnDraftSchema, WorldResultSchema } from '../../domain/drafts';
import { npc, organizationBase } from './game';
import { worldDraft, worldState } from './world';

export { original };
// Reconstructed minimum state, NOT the user's save, Story or Variables output.
// Entity IDs/times come from the response; roles/onScene and exact source narrative are test assumptions.
export function originalSchoolContext(actorsOnScene = true) {
  const base = worldState(), at = '2026-10-20T06:48:23.480Z';
  const state = GameStateSchema.parse({ ...base, worldClock: '2026-10-20T06:38:23.480Z',
    protagonist: { ...base.protagonist, id: 'protagonist', name: '1', locationId: 'office_38th' },
    npc: {
      npc_liu_san: { ...npc('npc_liu_san'), name: '刘成福', onScene: actorsOnScene, locationId: 'office_38th' },
      npc_wang_guifen: { ...npc('npc_wang_guifen'), name: '王桂芬', onScene: actorsOnScene, locationId: 'office_38th' },
    },
    organizations: {
      org_school_38th: { ...organizationBase, id: 'org_school_38th', name: '三十八中', kind: 'government',
        lawfulPowers: ['校内管理'], cases: [], administrativeAffairs: [] },
      org_dingsheng: { ...organizationBase, id: 'org_dingsheng', name: '鼎盛商务', kind: 'business',
        sectors: ['商务'], businessRelations: [] },
    },
    locations: { ...base.locations,
      school_38th: { id: 'school_38th', name: '第三十八中学', parentId: 'chongqing' },
      office_38th: { id: 'office_38th', name: '学校办公室', parentId: 'school_38th' },
    },
  });
  const draftBase = worldDraft(true, 'opening');
  const facts = [...original.taskCommands, ...original.eventCommands].map(command => JSON.parse(command.evidence).fact);
  const draft = TurnDraftSchema.parse({ ...draftBase, turnId: original.eventCommands[0].event.sourceTurnIds[0],
    story: { ...draftBase.story, narrative: facts.join('\n'), summary: '合成来源旁白，仅用于隔离校验路径，不代表原始正文。' },
    variables: { ...draftBase.variables, result: { commands: [{ type: 'SetWorldClock', commandId: 'clock',
      worldClock: at, evidence: '测试回合时间' }], rejectedSuggestions: [], unresolved: [] } },
  });
  return { state, draft, response: WorldResultSchema.parse({worldCommands:structuredClone(original.worldCommands),taskCommands:structuredClone(original.taskCommands),eventCommands:structuredClone(original.eventCommands),visibleHooks:structuredClone(original.visibleHooks),unresolved:structuredClone(original.unresolved)}) };
}
