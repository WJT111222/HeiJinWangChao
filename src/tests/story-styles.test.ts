import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composePrompt } from '../prompts/composer';
import { promptManifest } from '../prompts/manifest';
import { createTurnDraft } from '../domain/drafts';
import { SettingsSchema, defaultSettings } from '../ui/settings/model';
import { STORY_STYLES, STORY_STYLE_IDS } from '../ui/settings/storyStyles';
import type { StoryStyle } from '../ui/settings/storyStyles';
import { game } from './fixtures/game';

/** 剧情风格：七种互斥，只影响正文笔法；不改输出格式、不改世界背景。 */
const text = (path: string) => readFileSync(resolve(process.cwd(), 'prompts', path), 'utf8');
const styleModules = promptManifest.modules.filter((m) => m.id.startsWith('writing.style_'));

describe('风格清单与提示词模块一一对应', () => {
  it('七种风格，默认一般；界面说明与模块顺序一致', () => {
    expect(STORY_STYLE_IDS).toEqual(['general', 'jianghu', 'noir', 'power', 'docu', 'shuang', 'absurd']);
    expect(STORY_STYLES.map((s) => s.id)).toEqual([...STORY_STYLE_IDS]);
    expect(defaultSettings().prompts.style).toBe('general');
    expect(promptManifest.globalDefaults.style).toBe('general');
    for (const style of STORY_STYLES) {
      expect(style.text.length).toBeGreaterThan(60);
      expect(style.text).not.toContain('你所在的城市');
      expect(style.text).not.toMatch(/主角像|主角的优势|人人都有点/u);
    }
  });
  it('每种风格恰好一个正文写作模块，按设置互斥启用、共用同一排序位', () => {
    expect(styleModules.map((m) => m.toggle).sort()).toEqual(STORY_STYLE_IDS.map((id) => `style:${id}`).sort());
    for (const m of styleModules) {
      expect(m).toMatchObject({ kind: 'prompt', activation: 'setting', applicableStages: ['story'], modes: ['opening', 'regular'],
        messageRole: 'system', category: 'writing', defaultOrder: 223, reorderable: false, placeholders: [] });
      expect(m.path).toBe(`writing/style_${m.toggle!.split(':')[1]}.md`);
    }
  });
  it('新风格都带参考防火墙与背景锚定，示例声明不得沿用人物与情节', () => {
    for (const id of STORY_STYLE_IDS.filter((id) => id !== 'general')) {
      const body = text(`writing/style_${id}.md`);
      expect(body).toContain('只借鉴叙事手法，不引入其中的人物、情节、台词、地名、年代、社会背景或超自然设定');
      expect(body).toContain('背景锚定：风格只决定笔法、节奏与语气。城市、年代、人物籍贯与口音、制度、世界规则与数值一律以当前存档和既有剧情为准');
      expect(body).toContain('不得沿用其中的人物、情节与对白，叙事人称以人称设置为准');
      expect(body).not.toContain('{{');
      // 主角性格以玩家填写的设定为准，风格不替主角定性格。
      expect(body).toContain('主角锚定：主角的性格、价值观、言行与选择始终以玩家填写的人物设定和玩家行动为准');
      expect(body).not.toMatch(/视点人物观察敏锐|主角的优势|人物有点狼狈/u);
    }
    // 广州是开局城市之一：江湖义气只禁止「因风格」改说粤语。
    expect(text('writing/style_jianghu.md')).toContain('人物本就说粤语、身处粤语城市时照常按存档书写');
  });
  it('设置只接受七种风格', () => {
    for (const style of STORY_STYLE_IDS) {
      const settings = defaultSettings(); settings.prompts.style = style;
      expect(SettingsSchema.safeParse(settings).success).toBe(true);
    }
    const bad = defaultSettings() as unknown as { prompts: { style: string } };
    bad.prompts.style = 'wuxia';
    expect(SettingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('组装：只换风格模块，其余请求不变', () => {
  const state = game(), draft = createTurnDraft(state.saveId, state.revision, 'turn-style', 'regular', '去码头');
  async function compose(style: StoryStyle) {
    const settings = defaultSettings(); settings.prompts.style = style;
    return composePrompt({ stage: 'story', mode: 'regular', state, settings, userInput: '去码头', draft });
  }
  it.each(STORY_STYLE_IDS)('%s：正文只启用对应风格模块，格式提醒与常驻前缀不变', async (style) => {
    const [general, current] = [await compose('general'), await compose(style)];
    const ids = current.modules.map((m) => m.id).filter((id) => id.startsWith('writing.style_'));
    expect(ids).toEqual([`writing.style_${style}`]);
    const body = text(`writing/style_${style}.md`);
    expect(current.messages.some((m) => m.content.includes(body.trim()))).toBe(true);
    expect(current.messages.at(-1)).toEqual(general.messages.at(-1));
    const prefix = promptManifest.ordering.lockedPrefix.length;
    expect(current.messages.slice(0, prefix)).toEqual(general.messages.slice(0, prefix));
    // 除风格模块本身与上下文设置里的风格名外，其余内容完全相同。
    const strip = (messages: { content: string }[]) => messages.map((m) => STORY_STYLE_IDS
      .reduce((c, id) => c.replace(text(`writing/style_${id}.md`).trim(), '<STYLE>'), m.content).replace(/\\?"style\\?":\\?"[a-z]+\\?"/gu, '"style":"<ID>"'));
    expect(strip(current.messages)).toEqual(strip(general.messages));
  });
  it.each(['variables', 'world'] as const)('%s 阶段不注入任何风格模块', async (stage) => {
    const settings = defaultSettings(); settings.prompts.style = 'noir';
    const { selectPromptModules } = await import('../prompts/selection');
    expect(selectPromptModules({ stage, mode: 'regular', settings, domains: [] }).some((m) => m.id.startsWith('writing.style_'))).toBe(false);
  });
});
