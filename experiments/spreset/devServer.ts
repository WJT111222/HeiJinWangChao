import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

export function prototypeSandbox(): Plugin {
  return {
    name: 'spreset-development-sandbox',
    apply: 'serve',
    async configureServer(server) {
      const source = (file: string) => readFileSync(resolve(server.config.root, 'experiments/spreset', file), 'utf8');
      const bundle = await build({
        configFile: false, logLevel: 'silent', publicDir: false,
        build: { write: false, minify: false, lib: {
          entry: resolve(server.config.root, 'experiments/spreset/worker.mjs'), name: 'SPreset', formats: ['iife'],
        } },
      });
      const output = Array.isArray(bundle) ? bundle[0] : bundle;
      if (!('output' in output) || output.output.length !== 1) throw new Error('Unexpected SPreset build output');
      const [chunk] = output.output;
      if (chunk.type !== 'chunk' || chunk.imports.length || chunk.dynamicImports.length)
        throw new Error('SPreset processor must be a standalone local script');
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/experiments/spreset/sandbox.html') return next();
        const nonce = randomBytes(24).toString('base64');
        // No Vite client, HMR or external imports run inside the processor origin.
        const script = source('frame.mjs') + '\nstartFrame(' + JSON.stringify(chunk.code).replaceAll('<', '\\u003c') + ');';
        response.setHeader('Content-Security-Policy', [
          'sandbox allow-scripts', "default-src 'none'", "script-src 'nonce-" + nonce + "'",
          'worker-src blob:', "connect-src 'none'", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'",
        ].join('; '));
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><meta charset="utf-8"><script type="module" nonce="' + nonce + '">' + script + '</script>');
      });
    },
  };
}
