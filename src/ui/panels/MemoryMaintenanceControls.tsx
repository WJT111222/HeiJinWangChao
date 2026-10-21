import { npcMaintenanceAvailable } from '../../domain/memories/npcMemory';
import type { GameState } from '../../domain/state';
import { compressionCandidates, compressionPolicy } from '../../domain/memories/compression';
import { readAiConfig } from '../../services/ai/configuration';
import { browserCredentials } from '../../services/ai/credentials';
import { redactInspection } from '../../services/ai/inspection';
import { resolveModelRoute } from '../../services/ai/snapshot';

export function MemoryMaintenanceControls({ state, phase, notice, onRun, onNpcRun, onCancel }: {
  state: GameState; phase?: 'generating' | 'saving'; notice: string; onRun: () => void; onNpcRun: () => void; onCancel: () => void;
}) {
  let route = '尚未配置记忆总结模型';
  try { const selected = resolveModelRoute(readAiConfig(localStorage), 'memory'); route = `${selected.channel.name} / ${selected.model}`; } catch { /* 展示安全空状态。 */ }
  const short = compressionCandidates(state, 'short').length, medium = compressionCandidates(state, 'medium').length;
  const npcDue = npcMaintenanceAvailable(state);
  const due = short > compressionPolicy.shortThreshold || medium > compressionPolicy.mediumThreshold;
  return <section className="card entry" aria-label="记忆维护">
    <h3>整理记忆</h3>
    <p>记忆总结模型：{redactInspection(route, browserCredentials())}</p>
    <p>可信活跃短期 {short} / 阈值 {compressionPolicy.shortThreshold}；中期 {medium} / 阈值 {compressionPolicy.mediumThreshold}</p>
    <p>{due ? '已达到整理阈值。' : '尚未达到整理阈值。'}旧档只读摘要不计入压缩批次，不补造未知时间。</p>
    <p className="muted">每次最多整理一批，可能产生额外API费用。整理失败不会删除记忆；正常游玩不受阻断。</p>
    <button disabled={Boolean(phase) || !due} onClick={onRun}>{phase === 'saving' ? '正在原子保存…' : phase ? '正在整理…' : '整理记忆（可能产生费用）'}</button>
    <p>私人记忆：{npcDue ? '存在可维护任务' : '暂无可安全维护任务'}。只手动整理一批，不显示人物身份或私有资料，不随公开自动维护运行。</p>
    <button disabled={Boolean(phase) || !npcDue} onClick={onNpcRun}>整理NPC私人记忆（可能产生费用）</button>
    {phase && <button disabled={phase === 'saving'} onClick={onCancel}>取消记忆整理</button>}
    <p role="status">{notice}</p>
  </section>;
}
