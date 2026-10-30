import { dateTime } from './playerView';
import type { ObservedMemory, PlayerView } from './playerView';
import { WorldRecord } from './WorldRecord';

const nature = { observed: '亲历 / 观察', reported: '转述（未核实）', suspected: '推测（未确认）', unknown: '认知来源未分类' };
export function MemoryRecord({ memory, view }: { memory: ObservedMemory; view: PlayerView }) {
  const owner = memory.ownerNpcId && (view.npc.find(person => person.id === memory.ownerNpcId)?.name
    ?? view.retiredNpcs.find(person => person.id === memory.ownerNpcId)?.name ?? memory.ownerNpcId);
  return <>
    <p className="muted">{memory.layer}{owner ? ` · 所属人物：${owner}` : ''} · {memory.visibility === 'internal'
      ? '内部世界记录 · 不代表任何角色已知' : memory.visibility === 'npc_private'
        ? '人物私有记录 · 不代表主角已知' : '主角已知记录'}</p>
    {memory.knowledgeKind && memory.visibility !== 'internal' && <span className="tag">{nature[memory.knowledgeKind]}</span>}
    <p>{memory.createdAtGameTime ? dateTime(memory.createdAtGameTime) : '历史回合时间未记录'}</p>
    <p className="prose">{memory.text}</p>
    {memory.knowledgeSource && <p>知识来源：{memory.knowledgeSource}</p>}
    {memory.npcProvenance && <WorldRecord title="总结来源与覆盖凭据" value={memory.npcProvenance} />}
    <WorldRecord title="记忆来源记录" value={{ sourceTurnIds: memory.sourceTurnIds, affectedEntityRefs: memory.affectedEntityRefs, visibility: memory.visibility }} />
  </>;
}
