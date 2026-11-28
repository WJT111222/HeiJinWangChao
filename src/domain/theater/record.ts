import { z } from 'zod';
import { CountSchema, IdSchema, requireData } from '../common';
import { modelIdSchema, ProtocolSchema } from '../../services/ai/configuration';

export const theaterLengths = [
  { id: 'short', name: '短篇', target: 1500 },
  { id: 'medium', name: '中篇', target: 3000 },
  { id: 'long', name: '长篇', target: 5000 },
  { id: 'extra', name: '超长篇', target: 10000 },
] as const;
export const maxTheaterBody = 1_000_000;
export const maxTheaterBackground = 36_000;
export const TheaterTitle = z.string().trim().min(1).max(100);
export const TheaterTheme = z.string().trim().min(1).max(4000);
export const TheaterTarget = z.number().int().min(100).max(100000);
export const TheaterPerspective = z.enum(['first', 'second', 'third']);
export const TheaterRoute = z.strictObject({
  channelId: IdSchema, model: modelIdSchema, protocol: ProtocolSchema,
  endpointHash: z.string().regex(/^[0-9a-f]{64}$/), sendTemperature: z.boolean(), sendMaxOutputTokens: z.boolean(),
  temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
});
export const theaterStates = { empty: '待生成', complete: '已完成', partial: '未完成', stopped: '已停止', failed: '失败' } as const;
export const TheaterRecordSchema = z.strictObject({
  version: z.literal(1), id: IdSchema, saveId: IdSchema, revision: CountSchema,
  title: TheaterTitle, theme: TheaterTheme,
  background: z.strictObject({
    turn: CountSchema, revision: CountSchema, schemaVersion: CountSchema,
    time: z.string().max(80).nullable(), protagonist: z.string().max(160),
    // Serialized, bounded context exactly as sent in the first request.
    context: z.string().min(1).max(maxTheaterBackground),
  }),
  config: z.strictObject({
    prompt: z.string().min(1).max(8000), target: TheaterTarget, perspective: TheaterPerspective, followsPerspective: z.boolean(),
    route: TheaterRoute, routeMode: z.enum(['story', 'independent']), stream: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(3600),
  }),
  body: z.string().max(maxTheaterBody),
  status: z.enum(['empty', 'complete', 'partial', 'stopped', 'failed']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).refine(value => ['empty', 'failed'].includes(value.status) ? value.body === '' : Boolean(value.body.trim()));
export type TheaterRecord = z.infer<typeof TheaterRecordSchema>;
export type TheaterBackground = TheaterRecord['background'];
export type TheaterRoute = z.infer<typeof TheaterRoute>;
export type TheaterPerspective = z.infer<typeof TheaterPerspective>;

export function parseTheaters(value: unknown, saveId: string) {
  const entries = z.array(TheaterRecordSchema).parse(value);
  requireData(new Set(entries.map(entry => entry.id)).size === entries.length &&
    entries.every(entry => entry.saveId === saveId), 'THEATER_BACKUP', '小剧场的存档归属或记录 ID 无效。');
  return entries;
}
