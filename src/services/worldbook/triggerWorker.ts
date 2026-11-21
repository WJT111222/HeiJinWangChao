import { LibraryReader } from './libraryReader';
import { TriggerExecutor, type TriggerReply } from './triggerExecutor';

/** 触发 Worker 入口：只做“从本地书库读取版本 → 运行触发引擎”，不写任何存储。 */
export interface TriggerJob { id: number; kind: 'trigger'; request: unknown }
export interface TriggerJobReply { id: number; reply: TriggerReply }

const reader = new LibraryReader();
const executor = new TriggerExecutor((ref) => reader.read(ref.bookId, ref.versionId));

self.onmessage = async ({ data }: MessageEvent<TriggerJob>) => {
  let reply: TriggerReply;
  try {
    reply = data?.kind === 'trigger' ? await executor.execute(data.request) : { status: 'failed', reason: 'invalid_request' };
  } catch {
    // 固定错误码：不回传堆栈或书的内容。
    reply = { status: 'failed', reason: 'internal' };
  }
  self.postMessage({ id: data?.id, reply } satisfies Partial<TriggerJobReply>);
};
