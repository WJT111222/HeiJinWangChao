import { z } from 'zod';

// 只保存界面草稿与偏好；正式游戏状态始终通过 SaveRepository 读写。
export function readDocument<S extends z.ZodType>(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  schema: S,
): z.output<S> | undefined {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  return schema.parse(JSON.parse(raw));
}
export function writeDocument<S extends z.ZodType>(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  schema: S,
  value: z.input<S>,
): z.output<S> {
  const parsed = schema.parse(value);
  storage.setItem(key, JSON.stringify(parsed));
  return parsed;
}
