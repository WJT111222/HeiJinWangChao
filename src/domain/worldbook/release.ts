import { contentHash } from './canonical';
import { notice, type NoticeCollector } from './notices';
import {
  WORLDBOOK_FORMAT_VERSION, WorldbookMetadataSchema, WorldbookReleaseSchema,
  type WorldbookEntry, type WorldbookImportResult, type WorldbookMetadata, type WorldbookRelease,
} from './schema';

export interface ImportOptions {
  /** 玩家指定的书名，优先于文件内的名字。 */
  title?: string;
  /** 原文件名，用于在文件没有书名时生成书名。 */
  fileName?: string;
  /** 生成书 ID / 版本 ID；测试可注入固定值。 */
  newId?: () => string;
}

export const DEFAULT_TITLE = '未命名世界书';

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? Array.from(text).slice(0, 200).join('') : undefined;
}
function fileStem(fileName: string | undefined) {
  return fileName?.replace(/^.*[\\/]/, '').replace(/\.(json|txt)$/i, '');
}
/** 书名优先级：玩家指定 → 文件内候选（按传入顺序）→ 文件名 → 默认。 */
export function pickTitle(options: ImportOptions, ...candidates: unknown[]): string {
  for (const value of [options.title, ...candidates, fileStem(options.fileName)]) {
    const title = cleanTitle(value);
    if (title) return title;
  }
  return DEFAULT_TITLE;
}
export function optionalDescription(value: unknown): Pick<WorldbookMetadata, 'description'> {
  return typeof value === 'string' && value.trim() ? { description: value.slice(0, 20_000) } : {};
}

export interface FinishInput {
  entries: WorldbookEntry[];
  metadata: WorldbookMetadata;
  format: WorldbookRelease['source']['format'];
  payload: unknown;
  notices: NoticeCollector;
  options: ImportOptions;
  /** 王朝格式文件自带的身份；其他格式每次导入都新生成。 */
  identity?: Pick<WorldbookRelease, 'bookId' | 'versionId' | 'versionLabel'>;
}

/** 汇总为一个不可变版本：有任何 error 时不产生版本；来源一律标为 local。 */
export async function finishImport(input: FinishInput): Promise<WorldbookImportResult> {
  const { notices } = input;
  const metadata = WorldbookMetadataSchema.safeParse(input.metadata);
  if (!metadata.success) notices.add(notice('metadata_invalid', {}, { value: metadata.error.issues[0]?.message ?? '未知错误' }));
  if (notices.hasErrors || !metadata.success) return { ok: false, notices: notices.finish() };

  const newId = input.options.newId ?? (() => crypto.randomUUID());
  const source = { format: input.format, payload: input.payload };
  let hash: string;
  try {
    hash = await contentHash({ metadata: metadata.data, entries: input.entries, source });
  } catch {
    return { ok: false, notices: [...notices.finish(), notice('hash_failed')] };
  }
  const all = notices.finish();
  const candidate: WorldbookRelease = {
    formatVersion: WORLDBOOK_FORMAT_VERSION,
    bookId: input.identity?.bookId ?? newId(),
    versionId: input.identity?.versionId ?? newId(),
    versionLabel: input.identity?.versionLabel ?? '1.0',
    contentHash: hash,
    origin: 'local',
    metadata: metadata.data,
    entries: input.entries,
    source,
    compatibility: all.filter((item) => item.level !== 'error'),
  };
  const checked = WorldbookReleaseSchema.safeParse(candidate);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, notices: [...all, notice('release_invalid', {}, { value: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() })] };
  }
  // 以 candidate 为准：校验通过即可，避免 zod 复制对象后影响哈希覆盖的数据。
  return { ok: true, release: candidate, notices: all };
}
