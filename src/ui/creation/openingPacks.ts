import { z } from 'zod';
import { CreationSchema, newCreation, validateStep } from './model';
import type { Creation } from './model';
import { readDocument, writeDocument } from '../../services/local/documents';

// Only editable creation data. Runtime identity and the opening clock never enter a pack.
export const OpeningSettingsSchema = CreationSchema.omit({
  version: true, saveId: true, worldClock: true, openingTimePending: true, step: true,
});
export const OpeningPackSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  name: z.string().trim().min(1, '请填写开局包名称').max(80, '开局包名称最多80字符'),
  settings: OpeningSettingsSchema,
});
export type OpeningPack = z.infer<typeof OpeningPackSchema>;
export const openingPackPrefix = 'heijin.opening-pack.v1:';
type PackStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function openingSettings(form: Creation) {
  const parsed = CreationSchema.parse(form);
  for (let step = 1; step <= 4; step++) validateStep(parsed, step);
  return OpeningSettingsSchema.parse(Object.fromEntries(
    Object.keys(OpeningSettingsSchema.shape).filter(key => key in parsed)
      .map(key => [key, parsed[key as keyof Creation]]),
  ));
}
export function applyOpeningPack(pack: OpeningPack): Creation {
  const parsed = OpeningPackSchema.parse(pack);
  const form = { ...newCreation(), ...parsed.settings, step: 5 };
  openingSettings(form);
  return form;
}

// Each pack has its own record: a corrupt sibling cannot erase valid packs.
// No shared array/index is rewritten on rename, delete or update.
export class OpeningPackStore {
  constructor(private storage: PackStorage) {}
  list(): { packs: OpeningPack[]; invalidCount: number } {
    const packs: OpeningPack[] = [];
    let invalidCount = 0;
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(openingPackPrefix)) continue;
      // Storage access errors must propagate, rather than masquerade as corruption.
      const raw = this.storage.getItem(key);
      try {
        const pack = OpeningPackSchema.parse(JSON.parse(raw ?? 'null'));
        if (key !== openingPackPrefix + pack.id) throw new Error('身份不符');
        applyOpeningPack(pack);
        packs.push(pack);
      } catch { invalidCount++; }
    }
    return { packs, invalidCount };
  }
  private get(id: string) {
    z.uuid().parse(id);
    const pack = readDocument(this.storage, openingPackPrefix + id, OpeningPackSchema);
    if (!pack || pack.id !== id) throw new Error('开局包不存在或无法读取，请重新选择');
    return pack;
  }
  save(name: string, form: Creation, overwriteId?: string) {
    // Overwrite only an explicitly selected, still-existing valid record.
    const id = overwriteId ? this.get(overwriteId).id : crypto.randomUUID();
    const pack = OpeningPackSchema.parse({ version: 1, id, name, settings: openingSettings(form) });
    return writeDocument(this.storage, openingPackPrefix + id, OpeningPackSchema, pack);
  }
  rename(id: string, name: string) {
    return writeDocument(this.storage, openingPackPrefix + id, OpeningPackSchema, { ...this.get(id), name });
  }
  delete(id: string) {
    this.get(id);
    this.storage.removeItem(openingPackPrefix + id);
  }
}
