// SPDX-License-Identifier: GPL-3.0-only
// Build the fixed local worker with its opaque-origin broker and corresponding source.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
const read = name => readFileSync(new globalThis.URL(name, import.meta.url), 'utf8');
export function oracleAssets() {
  const source = {
    'frame.mjs': read('../spreset/frame.mjs'), 'pipeline.mjs': read('pipeline.mjs'),
    'worker.mjs': read('worker.mjs'), 'COPYING': read('../spreset/COPYING'),
    'SOURCES.json': read('SOURCES.json'), 'AUTHOR.txt': read('../../docs/tavernhelper-compat/meowssiah/AUTHOR.txt'),
    'build.mjs': read('build.mjs'),
  };
  return { ...Object.fromEntries(Object.entries(source).map(([k,v]) => ['source/' + k, v])),
    'sandbox.html': sandboxFromSources(source) };
}

function sandboxFromSources(source) {
  const definitions = source['pipeline.mjs'].replace(/^export /gm, '');
  const worker = definitions + '\n' + source['worker.mjs'].replace(/^import .*from '.\/pipeline.mjs';$/m, '').replace(/^export /gm, '');
  const broker = source['frame.mjs'].replace("name: 'spreset-c2'", "name: 'meowssiah'");
  const script = broker + '\nstartFrame(' + JSON.stringify(worker).replaceAll('<','\\u003c') + ');';
  const hash = createHash('sha256').update(script).digest('base64');
  const policy = "default-src 'none'; script-src 'sha256-" + hash + "'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><script type="module">' + script + '</script>';
}

// With the five files downloaded from /source/ this rebuild needs only Node, no npm or network.
if (process.argv[2] === '--standalone' && import.meta.url === new globalThis.URL('file:' + process.argv[1]).href) {
  const files = ['frame.mjs','pipeline.mjs','worker.mjs'];
  writeFileSync('sandbox.html', sandboxFromSources(Object.fromEntries(files.map(name => [name, read(name)]))));
}
