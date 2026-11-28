// SPDX-License-Identifier: GPL-3.0-only
import { createSession } from './core.mjs';
const processRequest = createSession();
globalThis.onmessage = ({ data }) => {
  try { globalThis.postMessage({ result: processRequest(data.operation, data.input) }); }
  catch { globalThis.postMessage({ error: true }); }
};
