import { z } from 'zod';

/**
 * 世界书 2.0 的规范化数据结构（阶段 A：只有纯数据，不入库、不参与请求）。
 *
 * 字段语义以 SillyTavern 1.19.0（7e8663cd）的世界书条目为兼容参照，按
 * docs/WORLDBOOK_COMPATIBILITY.md 的行为说明独立实现；未复制上游源码。
 * null 一律表示“跟随全局设置”，不在导入时替它填默认值。
 */

export const WORLDBOOK_FORMAT = 'heijin-worldbook';
export const WORLDBOOK_FORMAT_VERSION = 1;

/** 主副关键词逻辑：0 AND ANY，1 NOT ALL，2 NOT ANY，3 AND ALL。 */
export const SELECTIVE_LOGIC = { andAny: 0, notAll: 1, notAny: 2, andAll: 3 } as const;
/** 插入位置编号（与参照版本一致）。王朝能对应到哪里在 Story 集成阶段决定。 */
export const ENTRY_POSITIONS = {
  before: 0, after: 1, authorNoteTop: 2, authorNoteBottom: 3, atDepth: 4, exampleTop: 5, exampleBottom: 6, outlet: 7,
} as const;
export const GENERATION_TRIGGERS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'] as const;

export const WorldbookOrigins = ['official', 'workshop', 'local'] as const;
export const WorldbookSourceFormats = ['sillytavern', 'character-card-v2', 'heijin'] as const;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
/** 原样透传的对象（不重建键，避免 "__proto__" 之类的键在复制时丢失）。 */
export const PlainObjectSchema = z.custom<Record<string, unknown>>(plainObject, '必须是对象');
export { plainObject as isPlainObject };

const finite = z.number().finite();
const nullableFinite = finite.nullable();
export const IdentifierSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'ID 只能包含字母、数字和 ._:-，最长 128 位');

export const WorldbookEntrySchema = z.strictObject({
  /** 王朝稳定 ID，书内唯一。 */
  entryId: z.string().min(1).max(200),
  /** 原文件里的条目 ID（酒馆 uid / 角色卡 id），可能缺失或重复。 */
  sourceUid: z.union([finite, z.string()]).nullable(),
  /** 原文件 entries 容器里的键（字典键或数组下标），用于无损导出。 */
  sourceKey: z.string().nullable(),
  comment: z.string(),
  content: z.string(),
  keys: z.array(z.string()),
  secondaryKeys: z.array(z.string()),
  selective: z.boolean(),
  selectiveLogic: z.number().int(),
  constant: z.boolean(),
  disabled: z.boolean(),
  order: finite,
  position: z.number().int(),
  depth: finite,
  role: z.number().int(),
  outletName: z.string(),
  probability: finite,
  useProbability: z.boolean(),
  /** 逗号分隔的多组字符串，原样保留，不在导入时拆开。 */
  group: z.string(),
  groupOverride: z.boolean(),
  groupWeight: finite,
  useGroupScoring: z.boolean().nullable(),
  scanDepth: nullableFinite,
  caseSensitive: z.boolean().nullable(),
  matchWholeWords: z.boolean().nullable(),
  excludeRecursion: z.boolean(),
  preventRecursion: z.boolean(),
  /** 布尔或整数层级，两种都保留。 */
  delayUntilRecursion: z.union([z.boolean(), finite]),
  sticky: nullableFinite,
  cooldown: nullableFinite,
  delay: nullableFinite,
  ignoreBudget: z.boolean(),
  triggers: z.array(z.string()),
  /** 不参与王朝触发的保留字段：角色筛选、角色卡扫描、向量、自动化、界面排序等。只在原文件出现时才有。 */
  inert: PlainObjectSchema,
  extensions: PlainObjectSchema,
});
export type WorldbookEntry = z.infer<typeof WorldbookEntrySchema>;

export const ImportNoticeSchema = z.strictObject({
  level: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  entryRef: z.string().optional(),
  field: z.string().optional(),
  message: z.string(),
});
export type ImportNotice = z.infer<typeof ImportNoticeSchema>;

export const WorldbookMetadataSchema = z.strictObject({
  purpose: z.enum(['ordinary', 'main']).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  creator: z.string().max(200).optional(),
  sourceUrl: z.string().max(2_000).optional(),
  license: z.string().max(200).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  language: z.string().max(35).optional(),
});
export type WorldbookMetadata = z.infer<typeof WorldbookMetadataSchema>;

export const WorldbookReleaseSchema = z.strictObject({
  formatVersion: z.literal(WORLDBOOK_FORMAT_VERSION),
  bookId: IdentifierSchema,
  versionId: IdentifierSchema,
  versionLabel: z.string().min(1).max(60),
  /** SHA-256（小写十六进制），覆盖 metadata、entries 与 source；不含 origin、兼容提示等本地信息。 */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** 由发行层写入；导入器一律写 local，不信任文件自报。 */
  origin: z.enum(WorldbookOrigins),
  metadata: WorldbookMetadataSchema,
  entries: z.array(WorldbookEntrySchema),
  source: z.strictObject({ format: z.enum(WorldbookSourceFormats), payload: z.unknown() }),
  compatibility: z.array(ImportNoticeSchema),
});
export type WorldbookRelease = z.infer<typeof WorldbookReleaseSchema>;

/** 王朝格式文件：发行版本本体加格式标记。 */
export const WorldbookFileSchema = WorldbookReleaseSchema.extend({ format: z.literal(WORLDBOOK_FORMAT) });

export type WorldbookImportResult =
  | { ok: true; release: WorldbookRelease; notices: ImportNotice[] }
  | { ok: false; notices: ImportNotice[] };

export const WORLDBOOK_LIMITS = {
  /** 单个导入文件的 UTF-8 字节上限。 */
  maxBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
  /** 单条正文的字符上限。 */
  maxContentChars: 200_000,
  maxKeysPerEntry: 500,
  maxKeyChars: 2_000,
  /** JSON 嵌套层数上限（世界书正常不超过十几层；防止深嵌套让哈希等递归处理栈溢出）。 */
  maxDepth: 100,
  /** 导入报告最多保留的条数（超出时合并为一条说明）。 */
  maxNotices: 2_000,
} as const;
