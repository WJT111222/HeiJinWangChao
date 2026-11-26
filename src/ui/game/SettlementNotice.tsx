import type { SkippedUpdate } from '../../domain/updateSettlement';
import type { GameState } from '../../domain/state';

const names = { entities: '人物与实体', variables: '主角与现场', world: '场外与网络' };
const categories = { item: '物品', economy: '经济', person: '人物', task: '任务', event: '事件', world: '世界', state: '状态' };
const reasons = {
  syntax: '语法错误', schema: '缺少必填字段或字段格式错误', permission: '超出操作权限',
  reference: '关联记录无效', conflict: '与其他更新或现有记录冲突', time: '时间不符合规则',
  constraint: '未通过状态校验', dependency: '关联操作未执行',
};

export function SettlementNotice({ settlement }: { settlement: GameState['journal'][number]['settlement'] }) {
  if (!settlement) return null;
  const skipped = [...(settlement.entities?.skipped ?? []), ...(settlement.variables?.skipped ?? []), ...(settlement.world?.skipped ?? [])];
  const warnings = settlement.entities?.formatWarning || settlement.variables?.formatWarning || settlement.world?.formatWarning;
  const deferred = settlement.deferred ?? 0;
  if (!skipped.length && !deferred && !warnings) return null;
  return <details className="readout">
    <summary>本回合已结算{skipped.length ? `，跳过 ${skipped.length} 项更新` : ''}{deferred ? `，${deferred} 个到期阶段待处理` : ''}</summary>
    <SkippedUpdates skipped={skipped} />
    {(['entities','variables', 'world'] as const).map(stage => settlement[stage] && <p key={stage}>
      {names[stage]}已应用 {settlement[stage].accepted} 项
    </p>)}
    {deferred > 0 && <p>待处理阶段保留原定时间和已有入场安排。</p>}
    {warnings && <p>模型的规划或说明格式不完整，可执行命令已单独检查。</p>}
  </details>;
}

export function SkippedUpdates({ skipped }: { skipped: readonly SkippedUpdate[] }) {
  return skipped.length ? <ul>{skipped.map(update =>
      <li key={`${update.group}:${update.commandIndex}`}>
        {names[update.group === 'entities' || update.group === 'variables' ? update.group : 'world']}第 {update.commandIndex + 1} 条
        （{categories[update.category]}）未执行 · {reasons[update.reason]}
        {update.group !== 'entities' && update.group !== 'variables' && ` · ${update.group}.${update.groupIndex}`}{update.field && ` · ${update.field}`}
      </li>,
    )}</ul> : null;
}
