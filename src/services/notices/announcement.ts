import { z } from 'zod';

export const announcementMaxBytes = 32 * 1024;
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
export const AnnouncementSchema = z.object({
  version: text(64),
  title: text(100),
  theme: text(300),
  updates: z.array(text(2000)).min(1).max(20),
  message: text(2000),
}).strict();
export type Announcement = z.infer<typeof AnnouncementSchema>;

export function parseAnnouncement(raw: string): Announcement | undefined {
  if (raw.length > announcementMaxBytes) return;
  if (new TextEncoder().encode(raw).byteLength > announcementMaxBytes) return;
  try {
    const result = AnnouncementSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch { return; }
}
