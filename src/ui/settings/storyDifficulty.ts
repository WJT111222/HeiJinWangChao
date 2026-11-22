/**
 * 剧情难度：决定 NPC 和局势对主角说辞、计划的抵抗程度，与剧情风格（笔法）互不影响。
 * - relaxed（宽松）：不加任何规则，请求与引入难度之前逐字相同；旧设置缺少该字段时按宽松处理。
 * - standard（标准）：防口胡，对应 prompts/writing/difficulty_standard.md（正文阶段）。
 * - hardcore（硬核）：标准的全部规则 + 代价与反制，对应 prompts/writing/difficulty_hardcore.md（正文阶段），
 *   并在普通回合动态世界追加 prompts/shared/10_world_difficulty_hardcore.md。
 * 难度只通过上述模块进入请求；出站的 PROMPT_SETTINGS 不携带该字段。
 */
export const STORY_DIFFICULTY_IDS = ['relaxed', 'standard', 'hardcore'] as const;
export type StoryDifficulty = (typeof STORY_DIFFICULTY_IDS)[number];

/** 旧设置没有选过难度：维持原有体验。 */
export const DEFAULT_STORY_DIFFICULTY: StoryDifficulty = 'relaxed';
/** 新开局第五步默认选中的难度。 */
export const OPENING_STORY_DIFFICULTY: StoryDifficulty = 'standard';

export const STORY_DIFFICULTIES: readonly { id: StoryDifficulty; name: string; text: string }[] = [
  { id: 'relaxed', name: '宽松', text: '保持原来的体验，不额外约束。想随性推进剧情、偏爱顺风顺水时选它。' },
  { id: 'standard', name: '标准', text: '防口胡：嘴上说的不等于成真。NPC 会按自己的信息和利益判断真假，说服、谈判和欺骗要有真实筹码，谎言可能被核实、拆穿。' },
  { id: 'hardcore', name: '硬核', text: '在标准之上，成功要付出代价，NPC 默认谨慎，连续得手或高调行事会招来有比例的反制，失败的后果会持续影响后面的局面。所有阻力都来自已有的人物和因果，不凭空刁难。' },
];

export function storyDifficulty(prompts: { difficulty?: StoryDifficulty }): StoryDifficulty {
  return prompts.difficulty ?? DEFAULT_STORY_DIFFICULTY;
}
