import type { ImportNotice } from './schema';
import { WORLDBOOK_LIMITS } from './schema';

/** 导入报告的代码与中文文案。error 会让导入失败；warning / info 记入版本的兼容提示。 */
const messages = {
  // 文件级错误
  too_large: { level: 'error', text: (d: Detail) => `文件过大（约 ${d.value}），上限 ${d.limit}。` },
  invalid_json: { level: 'error', text: (d: Detail) => `不是有效的 JSON 文件${d.value ? `：${d.value}` : ''}。` },
  invalid_root: { level: 'error', text: () => '文件内容必须是一个 JSON 对象。' },
  unknown_format: { level: 'error', text: () => '无法识别的世界书格式：需要酒馆世界书（含 entries）、角色卡 V2（含 character_book）或王朝世界书格式。' },
  unsupported_format: { level: 'error', text: (d: Detail) => `暂不支持导入：${d.value}。` },
  too_deep: { level: 'error', text: (d: Detail) => `JSON 嵌套超过 ${d.limit} 层，已拒绝导入。` },
  hash_failed: { level: 'error', text: () => '无法计算内容哈希，已拒绝导入。' },
  entries_invalid: { level: 'error', text: () => 'entries 必须是对象或数组。' },
  too_many_entries: { level: 'error', text: (d: Detail) => `条目数 ${d.value} 超过上限 ${d.limit}。` },
  native_invalid: { level: 'error', text: (d: Detail) => `王朝世界书文件结构不正确：${d.value}。` },
  hash_mismatch: { level: 'error', text: () => '王朝世界书文件的内容哈希对不上，文件可能被修改或损坏，已拒绝导入。' },
  metadata_invalid: { level: 'error', text: (d: Detail) => `书籍信息不合法：${d.value}。` },
  release_invalid: { level: 'error', text: (d: Detail) => `整理后的世界书不符合结构要求：${d.value}。` },
  duplicate_entry_id: { level: 'error', text: (d: Detail) => `王朝世界书文件里有重复的条目 ID：${d.value}。` },
  // 条目级错误
  entry_not_object: { level: 'error', text: () => '条目必须是对象。' },
  field_type: { level: 'error', text: (d: Detail) => `字段类型不正确，需要${d.value}。` },
  content_too_long: { level: 'error', text: (d: Detail) => `正文超过 ${d.limit} 字。` },
  too_many_keys: { level: 'error', text: (d: Detail) => `关键词超过 ${d.limit} 个。` },
  key_too_long: { level: 'error', text: (d: Detail) => `关键词超过 ${d.limit} 字。` },
  // 警告：导入成功，但行为需要玩家知道
  value_coerced: { level: 'warning', text: (d: Detail) => `原值 ${d.value} 已按酒馆的宽松读法转换为 ${d.limit}。` },
  missing_required: { level: 'warning', text: (d: Detail) => `缺少规范要求的字段，按 ${d.value} 处理。` },
  duplicate_uid: { level: 'warning', text: (d: Detail) => `条目 ID ${d.value} 重复，王朝内部改用 ${d.limit} 区分；原 ID 保留。` },
  never_triggers: { level: 'warning', text: () => '非常驻条目没有关键词，永远不会被触发（保持原样，不会自动改成常驻）。' },
  blank_key: { level: 'warning', text: () => '含有只由空白组成的关键词：按参照版本的行为，它会匹配任何文本。' },
  regex_invalid: { level: 'warning', text: (d: Detail) => `关键词 ${d.value} 形如正则但无法解析，按参照版本的行为当作普通文本匹配。` },
  regex_unsupported: { level: 'warning', text: (d: Detail) => `正则关键词 ${d.value} ${d.limit}，暂不支持：触发时不会运行它，按不命中处理。` },
  unknown_logic: { level: 'warning', text: (d: Detail) => `副关键词逻辑 ${d.value} 不是已知取值（0–3）：有副关键词时该条目永远不会被触发。` },
  unknown_position: { level: 'warning', text: (d: Detail) => `插入位置 ${d.value} 不是已知取值（0–7）。` },
  character_filter_inert: { level: 'warning', text: () => '设置了角色筛选。王朝没有角色卡，这项设置会保留但不生效。' },
  match_source_inert: { level: 'warning', text: (d: Detail) => `设置了扫描角色卡文本（${d.value}）。王朝没有对应文本，这项设置会保留但不生效。` },
  vectorized_inert: { level: 'warning', text: () => '设置了向量检索。王朝不支持，这项设置会保留但不生效。' },
  automation_ignored: { level: 'warning', text: () => '设置了自动化 ID。王朝永远不会执行它，只保留字段。' },
  // 说明
  position_unmapped: { level: 'info', text: (d: Detail) => `插入位置“${d.value}”在王朝正文请求中没有直接对应，接入正文时会单独说明处理方式。` },
  trigger_unmapped: { level: 'info', text: (d: Detail) => `触发模式 ${d.value} 在王朝没有对应动作。` },
  regex_sticky_flag: { level: 'info', text: (d: Detail) => `正则关键词 ${d.value} 带 y 标志：只从扫描文本开头匹配，通常不会命中（与参照版本一致）。` },
  macro_preserved: { level: 'info', text: () => '正文或关键词含 {{…}} 宏：已原样保留，导入时不执行。' },
  unknown_fields_preserved: { level: 'info', text: (d: Detail) => `保留了王朝不认识的字段：${d.value}。导出时会原样带回。` },
  book_setting_unused: { level: 'info', text: (d: Detail) => `书级设置 ${d.value} 参照版本转换时不使用，已原样保留。` },
  entry_field_unused: { level: 'info', text: (d: Detail) => `字段 ${d.value} 参照版本转换时不使用，已原样保留。` },
  card_content_skipped: { level: 'info', text: () => '只导入了角色卡里的世界书；角色描述、开场白等其余内容没有导入，也不会进入提示词。' },
  origin_ignored:{ level: 'info', text: (d: Detail) => `文件自称来源为 ${d.value}，导入后一律视为本地导入。` },
  export_lossy: { level: 'info', text: (d: Detail) => `导出为酒馆格式时不包含：${d.value}。需要完整保留请导出王朝格式。` },
  notices_truncated: { level: 'info', text: (d: Detail) => `提示过多，另有 ${d.value} 条未列出。` },
} as const satisfies Record<string, { level: ImportNotice['level']; text: (d: Detail) => string }>;

export type NoticeCode = keyof typeof messages;
export interface Detail { value?: string | number; limit?: string | number }

export function notice(code: NoticeCode, where: { entryRef?: string; field?: string } = {}, detail: Detail = {}): ImportNotice {
  const spec = messages[code];
  return {
    level: spec.level,
    code,
    ...(where.entryRef !== undefined ? { entryRef: where.entryRef } : {}),
    ...(where.field !== undefined ? { field: where.field } : {}),
    message: spec.text(detail),
  };
}

/** 收集器：超过上限时只保留前面的提示，最后补一条合并说明；error 永远保留。 */
export class NoticeCollector {
  readonly items: ImportNotice[] = [];
  private dropped = 0;
  add(item: ImportNotice) {
    if (item.level === 'error' || this.items.length < WORLDBOOK_LIMITS.maxNotices) this.items.push(item);
    else this.dropped++;
  }
  get hasErrors() { return this.items.some((item) => item.level === 'error'); }
  finish(): ImportNotice[] {
    return this.dropped ? [...this.items, notice('notices_truncated', {}, { value: this.dropped })] : [...this.items];
  }
}
