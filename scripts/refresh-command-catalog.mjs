import { argv } from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Run explicitly after changing catalog schemas. Tests reject stale generated data.
// No provider request, credentials, repository or player save is accessed.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { inlineCommandCatalog } = await server.ssrLoadModule('/src/services/validation/commandCatalog.ts');
  const { describeTimeFormats, factorRepeatedSchemas } = await server.ssrLoadModule('/src/services/validation/catalogCompaction.ts');
  const schemas = Object.fromEntries(['world', 'variables'].map(stage => [stage,
    factorRepeatedSchemas(describeTimeFormats(inlineCommandCatalog(stage).schema)),
  ]));
  const output = new URL('../src/services/validation/commandCatalogSchemas.json', import.meta.url);
  const expected = JSON.stringify(schemas) + '\n';
  if (argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== expected) throw new Error('Display schemas are stale; run npm run catalog:refresh.');
    log('World/Variables display schemas match current runtime schemas.');
  } else {
    await writeFile(output, expected);
    log('Refreshed World/Variables display schemas; runtime validators unchanged.');
  }
} finally { await server.close(); }
