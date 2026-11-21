import { runImportJob, type ImportJob, type ImportJobReply } from './libraryJob';

/** 书库 Worker 入口：导入并安装世界书文件，不在主线程解析与哈希。 */
self.onmessage = async ({ data }: MessageEvent<ImportJob>) => {
  let reply: ImportJobReply;
  try {
    reply = data?.kind === 'import-install' ? await runImportJob(data) : { ok: false, code: 'internal', notices: [] };
  } catch {
    reply = { ok: false, code: 'internal', notices: [] };
  }
  self.postMessage({ id: data?.id, reply });
};
