import { useState } from 'react';
import type { ReactNode } from 'react';
import { Empty } from '../Dialog';

const labels: Record<string, string> = {
  id: '记录 ID', identityKey: '稳定身份', name: '名称', title: '标题', kind: '类型', status: '状态',
  startAt: '开始时间', estimatedEndAt: '预计结束时间', resolvedAt: '实际结束时间', dueAt: '截止时间',
  actorRef: '行动者', actorRefs: '参与者', backgroundText: '背景', goalText: '目标', goal: '目标',
  prerequisites: '前置条件', blockers: '阻碍', linkedTaskIds: '关联任务', linkedEventId: '关联事件',
  predecessorEventIds: '前序事件', completionCondition: '附加完成条件', impact: '影响程度',
  sourceTurnIds: '来源回合', sourceTurnId: '来源回合', resolutionText: '完整结果叙述（含人物陈述）',
  resultKnowledge: '成果认知分类', facts: '已核实事实', reported: '转述（未核实）', suspected: '推测',
  visibility: '角色知晓标记（不限制玩家阅读）', locationId: '地点 ID', outcome: '结果',
  description: '介绍', protagonistRelation: '与主角关系', relationHistory: '关系历史',
  keyNpcIds: '主要人物', currentTaskIds: '当前任务', sectors: '行业', industries: '产业',
  territoryText: '地盘', funds: '资金（分）', powerText: '实力', internalStatus: '内部状况',
  jurisdictionText: '管辖范围', lawfulPowers: '法定权限', cases: '案件', administrativeAffairs: '行政事务',
  enforcementCapacityText: '执行能力', publicTrustText: '公众信任', missionText: '宗旨', supportersText: '支持者',
  membershipText: '成员', activities: '活动', activityAreaText: '活动范围', publicInfluenceText: '社会影响',
  assetsEstimate: '资产估值（分）', liquidityEstimate: '流动资金估值（分）', ownershipText: '所有权',
  operatingStatus: '经营状态', businessRelations: '商业关系', ownerRef: '持有人', quantity: '数量',
  conditionText: '状态说明', cash: '现金（分）', onlineBalance: '线上资金（分）', incomes: '收入记录', debts: '债务',
  properties: '房产', vehicles: '车辆', otherAssets: '其他资产', estimatedValue: '估值（分）',
  acquiredAt: '取得时间', source: '来源', sourceMemoryIds: '原始记忆来源', npcId: '人物 ID',
  knowledgeKind: '认知类型', sourceVisibility: '原始角色知晓标记', createdAtGameTime: '记录游戏时间',
  retiredAt: '清理时间', publication: '历史归档记录', detail: '保留成果', resolution: '任务结果', handoff: '成果交接',
  identity: '身份', age: '年龄', aliases: '别名', appearance: '外貌', temperament: '性格', skills: '能力与技能',
  background: '个人背景', detailedBackground: '详细经历', onScene: '是否在场', affinity: '已存好感值',
  affinityConfirmed: '好感是否确认', relationshipText: '关系描述', healthText: '身体状态', lastInteractionAt: '最近互动时间',
  activeGoals: '个人目标', habits: '习惯', offscreenTaskIds: '场外任务', isContact: '已登记联系人', contactReviewPending: '旧档联系人待复核',
  affectedEntityRefs: '相关人物或组织', learnedAt: '获知时间',
  amount: '金额（分）', principal: '本金（分）', outstanding: '未偿本金（分）', creditor: '债权人', account: '账户',
  repaymentTerms: '偿还条件', autoPaymentAuthorized: '自动还款授权', collateralAssetIds: '抵押资产',
  expectedAt: '预计到账时间', receivedAt: '实际到账时间', model: '车型', plate: '车牌', mortgageDebtId: '抵押债务',
  category: '类别', details: '详情', parentId: '上级地点',
  storedAffinity: '存储好感值（未确认时仅为占位）',
};
function valueView(value: unknown): ReactNode {
  if (value === undefined || value === null) return <span className="muted">未记录</span>;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? <ol>{value.map((entry, index) => <li key={index}>{valueView(entry)}</li>)}</ol> : '无';
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, entry]) => <div className="world-record-field" key={key}>
    <dt>{labels[key] ?? key}</dt><dd>{valueView(entry)}</dd>
  </div>)}</dl>;
  return String(value);
}
/** 仅传入领域记录；不接收设置、凭证、请求快照或命令账本。React按文本转义。 */
export function WorldRecord({ value, title = '完整记录' }: { value: unknown; title?: string }) {
  return <details className="world-record"><summary>{title}</summary>{valueView(value)}</details>;
}
export function RecordList<T>({ label, entries, render, text = entry => JSON.stringify(entry) }: {
  label: string; entries: readonly T[]; render: (entry: T, index: number) => ReactNode; text?: (entry: T) => string;
}) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const matches = entries.filter(entry => text(entry).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const last = Math.max(0, Math.ceil(matches.length / 20) - 1), current = Math.min(page, last);
  return <section aria-label={label}>
    <label className="search">搜索{label}<input maxLength={4000} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    <p className="muted">{matches.length} 条记录 · 每页 20 条</p>
    {matches.slice(current * 20, (current + 1) * 20).map((entry, index) => <div key={current * 20 + index}>{render(entry, index)}</div>)}
    {!matches.length && <Empty>暂无符合条件的记录</Empty>}
    {last > 0 && <div className="memory-pagination">
      <button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>第 {current + 1} 页</span>
      <button disabled={current === last} onClick={() => setPage(current + 1)}>下一页</button>
    </div>}
  </section>;
}
