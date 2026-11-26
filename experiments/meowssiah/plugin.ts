import type { Plugin } from 'vite';
import { oracleAssets } from './build.mjs';

export function oracleSandbox(): Plugin {
  const prefix = 'literature/meowssiah/';
  return {
    name: 'meowssiah-local-literature',
    configureServer(server) {
      const assets = new Map(Object.entries(oracleAssets()));
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path?.startsWith('/' + prefix)) return next();
        const data = assets.get(path.slice(prefix.length + 1));
        if (typeof data !== 'string') return next();
        response.setHeader(
          'Content-Type',
          path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        );
        response.end(data);
      });
    },
    generateBundle() {
      for (const [file, source] of Object.entries(oracleAssets()))
        this.emitFile({ type: 'asset', fileName: prefix + file, source: String(source) });
    },
  };
}
