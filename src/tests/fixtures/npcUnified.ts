import { npcMemoryState, npcSummaryOutput } from './npcMemory';
import { planNpcSummary, parseNpcSummary, applyNpcSummary } from '../../domain/memories/npcMemory';

export const fullPrivateProfile = {
  bodyDescription: '原始体态描述\n第二行', chestDescription: '原始胸部资料', pussyDescription: '原始私密资料\n保留原文',
  isVirgin: false, firstExperienceTarget: '原记录对象', firstExperienceTime: '某年冬季', firstExperienceText: '原始经历全文\n末尾空格  ',
};
/** Synthetic actual old representation, not passed through the current canonical schema. */
export function legacyNpcMemories(version: 6 | 7 = 7, withSummary = true) {
  let state = npcMemoryState(21, true);
  const person = state.npc['npc-a'];
  if (person.kind !== 'special') throw Error();
  person.age = 30; person.gender = 'female'; person.privateProfile = { ...fullPrivateProfile };
  person.memories[0].text = '  原始文本\n逐字保留，含标点与空白。  ';
  person.memories[0].knowledgeSource = '  原始来源，未改写  ';
  const last = person.memories.at(-1)!; delete last.knowledgeKind;
  person.memories[16] = { ...person.memories[16], text: '[转述]仍待确认的消息', knowledgeKind: 'reported' };
  person.memories[17] = { ...person.memories[17], text: '[推测]尚不确定的判断', knowledgeKind: 'suspected' };
  if (withSummary) {
    const batch = planNpcSummary(state, 'npc-a')!;
    state = applyNpcSummary(state, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'old-summary'));
  }
  const owner = state.npc['npc-a'];
  if (owner.kind !== 'special') throw Error();
  const all = [...owner.memories]; owner.memories = all.filter((_, i) => i % 2 === 0); owner.longTermMemories = all.filter((_, i) => i % 2 === 1);
  return { ...state, schemaVersion: version };
}
