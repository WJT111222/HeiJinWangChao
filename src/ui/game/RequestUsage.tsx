import { useSyncExternalStore } from 'react';
import { requestInspections } from '../../services/ai/inspection';

const names = { story: '正文', variables: '变量', world: '动态世界', memory: '记忆维护' };
// 只读数字和已脱敏模型名；不展示输入正文、NPC身份或私有内容，也不合并多次请求。
export function RequestUsage({ saveId, memoryOnly = false }: { saveId: string; memoryOnly?: boolean }) {
  const records = useSyncExternalStore(requestInspections.subscribe, requestInspections.getSnapshot);
  const selected = records.filter((item) => item.scope?.saveId === saveId && (memoryOnly ? item.stage === 'memory' : item.stage !== 'memory')).slice(0, 6);
  if (!selected.length) return null;
  return <section className="request-usage" aria-label={memoryOnly ? '记忆请求 Token 用量' : '本次请求 Token 用量'}>
    {selected.map((item) => <div key={item.id}>
      <p>{names[item.stage]} · {item.route.model} · {item.status === 'pending' ? '请求中' : item.status === 'failed' ? '请求失败' : '响应已接收'}
        <br />本次请求输入：≈ {item.statistics.estimatedTokens.toLocaleString('zh-CN')} Token（估算输入 Token）
        <br />最大输出设置：{item.outputTokenLimit?.toLocaleString('zh-CN') ?? '服务默认（未发送上限）'}
      </p>
      <small>实际输入：{item.statistics.actual.inputTokens ?? '未提供'}；实际输出：{item.statistics.actual.outputTokens ?? '未提供'}；
        实际总量：{item.statistics.actual.totalTokens ?? '未提供'}；思考 Token：{item.statistics.actual.reasoningTokens ?? '未提供'}</small>
    </div>)}
    <small>各次请求独立统计；Unicode启发式不含消息包装等协议开销，不是精确计费，不据此阻止请求。完整记录可在AI请求检查中查看。</small>
  </section>;
}
