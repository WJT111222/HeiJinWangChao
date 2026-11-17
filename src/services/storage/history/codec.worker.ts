import { encodeHistory, decodeHistory, exportHistory } from './codec';
import { DataError } from '../../../domain/common';
import { migrateSave } from '../migrations';
import type { CodecJob } from './worker';
self.onmessage = async ({ data }: MessageEvent<CodecJob>) => {
  try {
    const result = data.kind === 'export' ? await exportHistory(data.state, data.app)
      : data.kind === 'encode' ? await encodeHistory(data.state)
      : data.kind === 'decode' ? await decodeHistory(data.payload)
        : migrateSave(JSON.parse(data.json));
    self.postMessage({ ok: true, result });
  } catch (error) {
    // Fixed error codes only: never send model text, private profiles or stack traces.
    self.postMessage({ ok: false, code: error instanceof DataError ? error.code : 'HISTORY_CORRUPT' });
  }
};
