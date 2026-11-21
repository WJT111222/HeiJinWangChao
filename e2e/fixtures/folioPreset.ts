// Test-only resource. The loader executes this module inside its usual iframe.
export const folioId = 'fixture-folio';
export const folioPreset = {
  prompts: [{ identifier: 'folio-note', content: '合成档案' }, { identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'folio-note', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
  extensions: { tavern_helper: { scripts: [{
    type: 'script', id: 'folio-reader', name: '合成档案阅读器', enabled: true, module: true,
    content: `
      await new Promise(resolve => parent.addEventListener('folio-ready', resolve, { once: true }));
      const prefs = getVariables({ type: 'script' });
      replaceVariables({ boots: (prefs.boots || 0) + 1 }, { type: 'script' });
      eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, data => {
        data.messages.push({ role: 'user', content: 'folio-fixture-only' });
      });
      const original = parent.fetch;
      parent.fetch = async function(input, init) {
        const response = await original.call(parent, input, init);
        if (!String(input).endsWith('/api/backends/chat-completions/generate') || !response.ok) return response;
        let text, finish;
        if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
          const lines = (await response.text()).split('\\n');
          if (!lines.includes('data: [DONE]')) throw Error('folio: incomplete');
          const choices = lines.filter(s => s.startsWith('data: {')).map(s => JSON.parse(s.slice(6)).choices[0]);
          text = choices.map(c => c.delta.content || '').join('');
          finish = choices.find(c => c.finish_reason)?.finish_reason;
        } else {
          const data = await response.json();
          text = data.choices[0].message.content;
          finish = data.choices[0].finish_reason;
        }
        if (finish !== 'stop') throw Error('folio: finish');
        const page = JSON.parse(text).folio;
        if (typeof page !== 'string') throw Error('folio: bad page');
        return Response.json({ choices: [{ message: { content: page }, finish_reason: finish }] });
      };
    `,
  }] } },
};
