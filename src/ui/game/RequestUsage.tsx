import {useDesktopFeedback} from '../Feedback';
import { useSyncExternalStore } from 'react';
import { requestInspections } from '../../services/ai/inspection';

const names = { story: '正文', entities: '人物与实体', variables: '主角与现场', world: '场外与网络', memory: '记忆维护', theater: '小剧场', phone: '手机私聊' };
// 只读数字和已脱敏模型名；不展示输入正文、NPC身份或私有内容，也不合并多次请求。
// stage：PC 三阶段面板在各阶段概览里只显示该阶段的请求；完整列表仍在运行诊断。
/** 供应商返回缓存统计时才显示；命中与写入都已包含在实际输入里，不是另外收费的数量。 */
function cacheText(actual: { cacheReadTokens?: number; cacheWriteTokens?: number }) {
  const parts = [actual.cacheReadTokens !== undefined ? `缓存命中：${actual.cacheReadTokens}` : '', actual.cacheWriteTokens !== undefined ? `缓存写入：${actual.cacheWriteTokens}` : ''].filter(Boolean);
  return parts.length ? `；${parts.join('；')}（已含在实际输入内）` : '';
}
export function RequestUsage({ saveId, memoryOnly = false, stage }: { saveId: string; memoryOnly?: boolean; stage?: 'story' | 'entities' | 'variables' | 'world' }) {
  const desktop=useDesktopFeedback();
  const records = useSyncExternalStore(requestInspections.subscribe, requestInspections.getSnapshot);
  const selected = records.filter((item) => item.scope?.saveId === saveId && (stage ? item.stage === stage : memoryOnly ? item.stage === 'memory' : item.stage !== 'memory')).slice(0, 6);
  if (!selected.length) return null;
  return <section className="request-usage" aria-label={stage ? '本阶段请求 Token 用量' : memoryOnly ? '记忆请求 Token 用量' : '本次请求 Token 用量'}>
    {selected.map((item) => <div key={item.id}>
      <p>{names[item.stage]} · {item.route.model} · {item.status === 'pending' ? '请求中' : item.status === 'failed' ? '请求失败' : '响应已接收'}
        <br />本次请求输入：≈ {item.statistics.estimatedTokens.toLocaleString('zh-CN')} Token（估算输入 Token）
        <br />最大输出设置：{item.outputTokenLimit?.toLocaleString('zh-CN') ?? '服务默认（未发送上限）'}
      </p>
      {desktop?<small>实际输入：{item.statistics.actual.inputTokens ?? '未提供'}；实际输出：{item.statistics.actual.outputTokens ?? '未提供'}；
        实际总量：{item.statistics.actual.totalTokens ?? '未提供'}；思考 Token：{item.statistics.actual.reasoningTokens ?? '未提供'}{cacheText(item.statistics.actual)}</small>:<small className="mobile-usage-metrics"><span>实际输入：<b>{item.statistics.actual.inputTokens??'未提供'}</b></span><span>实际输出：<b>{item.statistics.actual.outputTokens??'未提供'}</b></span><span>实际总量：<b>{item.statistics.actual.totalTokens??'未提供'}</b></span><span>思考 Token：<b>{item.statistics.actual.reasoningTokens??'未提供'}</b></span>{item.statistics.actual.cacheReadTokens!==undefined&&<span>缓存命中：<b>{item.statistics.actual.cacheReadTokens}</b></span>}{item.statistics.actual.cacheWriteTokens!==undefined&&<span>缓存写入：<b>{item.statistics.actual.cacheWriteTokens}</b></span>}</small>}
    </div>)}
    <small>各次请求独立统计；Unicode启发式不含消息包装等协议开销，不是精确计费，不据此阻止请求。完整记录可在AI请求检查中查看。</small>
  </section>;
}
