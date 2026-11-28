import { expect, it } from 'vitest';
import { readPrototypeResponse } from '../presets/spreset/response';
import { callId, companionText, orderResponse, orderSamples, publicThought, scene } from './fixtures/toolOrder';

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) {
    for (const sample of orderSamples(protocol, stream)) {
      it(protocol + ' ' + (stream ? 'SSE' : 'JSON') + ' ' + sample.name + ' → ' + sample.expected, async () => {
        const { body, mime } = orderResponse(protocol, stream, sample);
        const actual = readPrototypeResponse(new Response(body, { headers: { 'Content-Type': mime } }), protocol, new AbortController().signal);
        if (sample.expected === 'competing') {
          await expect(actual).rejects.toMatchObject({ code: 'invalid_output', details: { fieldPath: 'tavern.upstream.tool' } });
          return;
        }
        const result = await actual;
        const text = companionText(sample);
        expect(result.text).toBe(text);
        expect(result.reasoning).toBe(sample.packets.flat().includes('thought') ? publicThought : '');
        if (sample.expected === 'text') {
          expect(result.call).toBeUndefined();
          expect(result.matchesDelivery).toBeUndefined();
          return;
        }
        expect(result.call).toEqual({ id: callId, name: 'submit_scene', args: { content: scene } });
        expect(result.matchesDelivery?.(scene)).toBe(true);
        if (text) {
          const before = sample.expected === 'tool';
          expect(result.matchesDelivery?.(scene, text)).toBe(before);
          expect(result.matchesDelivery?.(text + scene)).toBe(before);
          expect(result.matchesDelivery?.(scene, '\t'.repeat(text.length))).toBe(false);
        } else expect(result.matchesDelivery?.(scene, ' ')).toBe(false);
      });
    }
  }
}
