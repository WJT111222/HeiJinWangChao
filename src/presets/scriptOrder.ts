import { z } from 'zod';
import type { LoadedPreset } from './package';

export const buttonsSchema = z.array(z.object({ name: z.string().min(1), visible: z.boolean() }));
const scriptSchema = z.object({ id: z.string().min(1), name: z.string(), content: z.string(), enabled: z.boolean(),
  data: z.record(z.string(), z.json()).default({}), module: z.boolean().default(true), button: z.object({ enabled: z.boolean(), buttons: buttonsSchema }).optional() });
export type Script = z.infer<typeof scriptSchema>;
export function scriptOrder(nodes: LoadedPreset['scripts'], enabled = true): Script[] {
  return nodes.flatMap(node => {
    if (node.type === 'folder' && Array.isArray(node.scripts)) return scriptOrder(node.scripts, enabled && node.enabled === true);
    const script = scriptSchema.parse(node);
    return [{ ...script, enabled: enabled && script.enabled }];
  }).sort((a,b) => a.id < b.id ? -1 : Number(a.id > b.id));
}
