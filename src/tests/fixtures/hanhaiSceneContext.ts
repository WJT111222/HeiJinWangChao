import { readFileSync } from 'node:fs';
import { GameStateSchema } from '../../domain/state';
import { TurnDraftSchema } from '../../domain/drafts';
import { npc } from './game';
import { worldDraft, worldResult, worldState } from './world';

// Independent natural prose, not built from response fields. All state below is synthetic.
export const narrative = readFileSync(new URL('./hanhai-opening.txt', import.meta.url), 'utf8');
const people = [['npc_chen_hao', '陈浩'], ['npc_zhou_jianbin', '周建斌'], ['npc_lin_wanqiu', '林晚秋'], ['npc_tattoo_youth', '纹身青年']] as const;
export const quotes = [
  '吴杰涛停在柜台前，伸手挡住递来的欠条。',
  '陈浩伸手去取自己的证件，被压在柜台下的手挡了回来。',
  '周建斌把一万六千元的索赔单推向两人，又将分期欠条摊在桌上。',
  '林晚秋走进店里，按住桌上的笔，要求先核对器材交接记录。',
  '纹身青年站在门边，伸臂挡住出口。',
];
export function hanhaiSceneContext() {
  const prior = worldState(), at = '2024-10-18T18:10:00+08:00';
  const state = GameStateSchema.parse({ ...prior, worldClock: '2024-10-18T17:50:00+08:00',
    protagonist: { ...prior.protagonist, id: 'protagonist', name: '吴杰涛', locationId: 'hanhai_studio' },
    locations: { ...prior.locations, hanhai_studio: { id: 'hanhai_studio', name: '瀚海数码工作室', parentId: 'chongqing' } },
    npc: Object.fromEntries(people.map(([id, name]) => [id, { ...npc(id), name, locationId: 'hanhai_studio' }])),
  });
  const base = worldDraft(true, 'opening');
  const draft = TurnDraftSchema.parse({ ...base, story: { ...base.story, narrative, summary: '合成现场：索赔仍待处理。' },
    variables: { ...base.variables, result: { commands: [{ type: 'SetWorldClock', commandId: 'clock', worldClock: at, evidence: '本幕结束时间' }], rejectedSuggestions: [], unresolved: [] } },
  });
  const actorRefs = [{ kind: 'protagonist', id: 'protagonist' }, ...people.map(([id]) => ({ kind: 'npc', id }))];
  const evidence = { version: 1, kind: 'established', at, sources: ['story:current'],
    fact: '工作室内的索赔交涉遭遇异议，各方仍在对峙。', rationale: '将本幕已出现的现场交涉登记为待跟踪事件。',
    sceneRecord: { anchors: quotes.map((quote, i) => ({ source: 'story:current', quote, actorRefs: [actorRefs[i]] })) },
  };
  const event = { id: 'event_hanhai_lens_extortion', title: '瀚海数码工作室 · 现场记录',
    backgroundText: `现场依据：\n${quotes.join('\n')}`, goalText: '待处理：等待现场当事人下一步行动，不代表已经作出决定。',
    status: 'active', startAt: state.worldClock, estimatedEndAt: '2024-10-18T19:30:00+08:00', locationId: 'hanhai_studio', actorRefs,
    visibility: 'known', impact: 'significant', linkedTaskIds: [], prerequisites: [], blockers: [], sourceTurnIds: [draft.turnId],
    continuation: { direction: 'protagonist', reason: '交涉尚未结束，需要由玩家决定回应。', entry: { channel: '当面交涉', cue: '现场事项仍待回应，请决定下一步行动。', locationId: 'hanhai_studio' } },
  };
  const response = { ...worldResult(), visibleHooks: [], unresolved: [], eventCommands: [{ type: 'SaveEvent', commandId: 'event-init:hanhai_dispute', evidence: JSON.stringify(evidence), event }] };
  return { state, draft, response, evidence };
}
