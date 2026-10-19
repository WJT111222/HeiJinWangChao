import { promptManifest } from './manifest';
import { AiError } from '../services/ai/errors';
const resources = import.meta.glob('../../prompts/**/*.{md,txt,json}', {
  query: '?raw',
  import: 'default',
});
export async function readPromptResource(id: string): Promise<string> {
  const metadata = promptManifest.modules.find((module) => module.id === id);
  if (!metadata) throw new AiError('resource');
  const load = resources['../../prompts/' + metadata.path];
  if (!load) throw new AiError('resource');
  const content = await load();
  if (typeof content !== 'string') throw new AiError('resource');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== metadata.contentSha256 || Array.from(content).length !== metadata.characters)
    throw new AiError('resource');
  return content;
}
