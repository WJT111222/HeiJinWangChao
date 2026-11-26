import { describe, expect, it } from 'vitest';
import { newTrace, normalizeUpstream } from '../presets/tavern/upstream';
import type { Protocol } from '../services/ai/configuration';

const delivery = { id: 'provider-id-21', name: 'actual_content', args: { content: '港口交班。' } };
function frames(protocol: Protocol, stream: boolean, reason: string | null, calls = [delivery], text = '') {
  if (protocol === 'gemini') return [{ candidates: [{ content: { role: 'model', parts: [
    ...calls.map(functionCall => ({ functionCall })), ...(text ? [{ text }] : []),
  ] }, finishReason: reason }] }];
  if (protocol === 'anthropic') {
    const content = calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }));
    if (!stream) return [{ role: 'assistant', content: [...content, ...(text ? [{type:'text',text}] : [])], stop_reason: reason }];
    return [...content.flatMap((block,index) => [
      {type:'content_block_start',index,content_block:block}, {type:'content_block_stop',index},
    ]), ...(text ? [{type:'content_block_delta',index:content.length,delta:{type:'text_delta',text}}] : []),
    {type:'message_delta',delta:{stop_reason:reason}}, {type:'message_stop'}];
  }
  const tool_calls = calls.map((c,index) => ({index,id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}));
  return [{choices:[{[stream ? 'delta' : 'message']:{role:'assistant',content:text,tool_calls},finish_reason:reason}]}];
}
async function receive(protocol: Protocol, stream: boolean, packets: unknown[], expectedTool?: string) {
  const trace = newTrace();
  const source = stream ? new Response(packets.map(p => 'data: '+JSON.stringify(p)+'\n\n').join('')
    + (['openai','deepseek'].includes(protocol) ? 'data: [DONE]\n\n' : '')) : Response.json(packets[0]);
  const response = await normalizeUpstream(source, protocol, stream, new AbortController().signal, trace, expectedTool);
  await response.text();
  if (trace.error) throw trace.error;
  expect(trace.complete).toBe(true);
  return trace;
}
for (const protocol of ['openai','deepseek','gemini','anthropic'] as const) {
  const reason = {openai:'tool_calls',deepseek:'tool_calls',gemini:'STOP',anthropic:'tool_use'}[protocol];
  const textReason = {openai:'stop',deepseek:'stop',gemini:'STOP',anthropic:'end_turn'}[protocol];
  for (const stream of [false,true]) describe(protocol + (stream ? ' SSE' : ' JSON'), () => {
    const read = (packets: unknown[]) => receive(protocol,stream,packets,delivery.name);
    it('原协议的单次工具和纯文本均可交付', async () => {
      expect((await read(frames(protocol,stream,reason))).matchesDelivery?.(delivery.args.content)).toBe(true);
      expect((await read(frames(protocol,stream,textReason,[],'码头'))).finish).toBe(textReason);
    });
    it('拒绝外来工具或正文结束标记，以及缺失的原生结束状态',async () => {
      await expect(read(frames(protocol,stream,reason==='tool_calls'?'tool_use':'tool_calls'))).rejects.toThrow();
      await expect(read(frames(protocol,stream,protocol==='anthropic'?'stop':'end_turn',[],'码头'))).rejects.toThrow();
      await expect(read(frames(protocol,stream,null))).rejects.toMatchObject({code:'stream_interrupted'});
    });
    it('单次正文拒绝重复 ID、第二个调用、错名和竞争性文本',async () => {
      for (const calls of [[delivery,delivery],[delivery,{...delivery,id:'distinct'}],[{...delivery,name:'other'}]]) {
        await expect(read(frames(protocol,stream,reason,calls))).rejects.toMatchObject({code:'invalid_output'});
      }
      await expect(read(frames(protocol,stream,reason,[delivery],'另一个结尾'))).rejects.toMatchObject({code:'invalid_output'});
      const many = frames(protocol,stream,reason,[delivery,{...delivery,id:'second',name:'other'}]);
      expect((await receive(protocol,stream,many)).complete).toBe(true);
    });
  });
}
it('Gemini 相同带 ID 快照可跨事件重现，不能在单个事件里重复',async () => {
  const first = frames('gemini',true,null), end = frames('gemini',true,'STOP');
  expect((await receive('gemini',true,[...first,...end],delivery.name)).finish).toBe('STOP');
});
