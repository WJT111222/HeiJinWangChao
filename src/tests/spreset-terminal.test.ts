import { expect, it } from 'vitest';
import { malformedSceneResponse, terminalFaults } from './fixtures/spresetTerminal';
import { readPrototypeResponse } from '../presets/spreset/response';

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) {
    for (const invalid of terminalFaults(protocol, stream)) {
      it(protocol + (stream ? ' SSE ' : ' JSON ') + invalid + ' 在进入本地处理器前拒绝', async () => {
        await expect(readPrototypeResponse(malformedSceneResponse(protocol, stream, invalid), protocol, new AbortController().signal))
          .rejects.toMatchObject({ name: 'AiError' });
      });
    }
  }
}
