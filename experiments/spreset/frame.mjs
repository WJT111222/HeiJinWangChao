// SPDX-License-Identifier: GPL-3.0-only
// Trusted broker. Only the parent that navigated this opaque frame may bind a port.
export function startFrame(source) {
  const win = globalThis;
  if (win.origin !== 'null' || win === win.parent) return;
  const session = win.location.hash.slice(1);
  function bind(event) {
    if (event.source !== win.parent || event.origin !== new win.URL(win.location.href).origin
      || event.data?.bind !== session || !session || event.ports.length !== 1) return;
    win.removeEventListener('message', bind);
    const port = event.ports[0];
    const url = win.URL.createObjectURL(new win.Blob([source], { type: 'text/javascript' }));
    const worker = new win.Worker(url, { name: 'spreset-c2' });
    win.URL.revokeObjectURL(url);
    let sequence = 0, busy = false;
    function close() { worker.terminate(); port.close(); }
    function fail() { port.postMessage({ session, sequence, error: true }); close(); }
    worker.onerror = worker.onmessageerror = port.onmessageerror = fail;
    port.onmessage = ({ data }) => {
      const next = sequence + 1;
      if (busy || data?.session !== session || data.sequence !== next
        || next > 2 || data.operation !== (next === 1 ? 'prepare' : 'finish')) return fail();
      sequence = next;
      busy = true;
      worker.postMessage({ operation: data.operation, input: data.input });
    };
    worker.onmessage = ({ data }) => {
      if (!busy || !data || !Object.hasOwn(data, 'result')) return fail();
      busy = false;
      port.postMessage({ session, sequence, result: data.result });
      if (sequence === 2) close();
    };
    win.addEventListener('pagehide', close, { once: true });
  }
  win.addEventListener('message', bind);
}
