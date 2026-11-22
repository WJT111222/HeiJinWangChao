import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { composePrompt } from '../prompts/composer';
import { promptManifest } from '../prompts/manifest';
import { selectPromptModules } from '../prompts/selection';
import { createTurnDraft } from '../domain/drafts';
import { SettingsSchema, defaultSettings } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { STORY_DIFFICULTIES, STORY_DIFFICULTY_IDS, storyDifficulty } from '../ui/settings/storyDifficulty';
import type { StoryDifficulty } from '../ui/settings/storyDifficulty';
import { CreationWizard } from '../ui/creation/CreationWizard';
import { newCreation, selectProfession } from '../ui/creation/model';
import { game } from './fixtures/game';
import { stageContext } from './fixtures/eventStages';

/** 剧情难度：全局设置，宽松不改变任何请求；标准/硬核只通过各自模块进入请求。 */
const text = (path: string) => readFileSync(resolve(process.cwd(), 'prompts', path), 'utf8');
const difficultyModules = promptManifest.modules.filter((m) => m.toggle?.startsWith('difficulty:'));
function withDifficulty(difficulty?: StoryDifficulty): Settings {
  const settings = defaultSettings();
  if (difficulty) settings.prompts.difficulty = difficulty;
  return settings;
}

describe('剧情难度设置', () => {
  it('三档：宽松、标准、硬核；旧设置没有该字段时按宽松读取', () => {
    expect(STORY_DIFFICULTY_IDS).toEqual(['relaxed', 'standard', 'hardcore']);
    expect(STORY_DIFFICULTIES.map((item) => item.name)).toEqual(['宽松', '标准', '硬核']);
    const legacy = SettingsSchema.parse(JSON.parse(JSON.stringify(defaultSettings())));
    expect('difficulty' in legacy.prompts).toBe(false);
    expect(storyDifficulty(legacy.prompts)).toBe('relaxed');
  });
  it('设置只接受三档', () => {
    for (const id of STORY_DIFFICULTY_IDS) expect(SettingsSchema.safeParse(withDifficulty(id)).success).toBe(true);
    const bad = defaultSettings() as unknown as { prompts: { difficulty: string } };
    bad.prompts.difficulty = 'nightmare';
    expect(SettingsSchema.safeParse(bad).success).toBe(false);
  });
  it('模块登记：标准与硬核各一个正文模块，硬核另有普通回合动态世界模块；宽松没有模块', () => {
    expect(difficultyModules.map((m) => [m.id, m.toggle, m.applicableStages.join(), m.modes.join()]).sort()).toEqual([
      ['shared.10_world_difficulty_hardcore', 'difficulty:hardcore', 'world', 'regular'],
      ['writing.difficulty_hardcore', 'difficulty:hardcore', 'story', 'opening,regular'],
      ['writing.difficulty_standard', 'difficulty:standard', 'story', 'opening,regular'],
    ]);
    for (const m of difficultyModules) {
      expect(m).toMatchObject({ kind: 'prompt', activation: 'setting', configurable: true, permanent: false,
        reorderable: false, messageRole: 'system', placeholders: [] });
    }
    // 正文难度属于叙事核心，文学预设接管写作偏好时仍然生效。
    expect(difficultyModules.filter((m) => m.applicableStages.includes('story')).every((m) => m.category === 'narrative_core')).toBe(true);
    expect(difficultyModules.some((m) => m.toggle === 'difficulty:relaxed')).toBe(false);
  });
  it('硬核正文包含标准的全部规则，再追加代价与反制', () => {
    const standard = text('writing/difficulty_standard.md').split('\n\n').slice(1).map((p) => p.trim()).filter(Boolean);
    const hardcore = text('writing/difficulty_hardcore.md');
    for (const paragraph of standard) expect(hardcore).toContain(paragraph);
    for (const rule of ['成功有代价', 'NPC 默认谨慎', '得势招风', '失败要落地', '公平原则']) expect(hardcore).toContain(rule);
    expect(text('shared/10_world_difficulty_hardcore.md')).toContain('不得凭空制造新敌人');
  });
});

describe('组装：宽松与引入难度前逐字相同', () => {
  const state = game(), draft = createTurnDraft(state.saveId, state.revision, 'turn-difficulty', 'regular', '我跟他说我是市长的侄子，他信了');
  const story = (difficulty?: StoryDifficulty) =>
    composePrompt({ stage: 'story', mode: 'regular', state, settings: withDifficulty(difficulty), userInput: draft.userInput, draft });

  it('未设置与显式宽松：正文请求完全相同，不含任何难度模块，PROMPT_SETTINGS 不带难度字段', async () => {
    const [unset, relaxed] = [await story(), await story('relaxed')];
    expect(relaxed.messages).toEqual(unset.messages);
    expect(relaxed.modules).toEqual(unset.modules);
    expect(unset.modules.some((m) => m.id.includes('difficulty'))).toBe(false);
    const settingsBlock = /PROMPT_SETTINGS[^}]*\}/u;
    const block = unset.messages.map((m) => settingsBlock.exec(m.content)?.[0]).find(Boolean);
    expect(block).toBeTruthy();
    expect(block).not.toContain('difficulty');
  });
  it.each(['standard', 'hardcore'] as const)('%s：只多出对应正文模块，其余消息不变', async (difficulty) => {
    const [base, current] = [await story(), await story(difficulty)];
    const ids = current.modules.map((m) => m.id).filter((id) => id.includes('difficulty'));
    expect(ids).toEqual([`writing.difficulty_${difficulty}`]);
    const body = text(`writing/difficulty_${difficulty}.md`);
    const inserted = current.messages.filter((m) => m.content === body);
    expect(inserted).toHaveLength(1);
    expect(current.messages.filter((m) => m.content !== body)).toEqual(base.messages);
    expect(current.messages.map((m) => /PROMPT_SETTINGS[^}]*\}/u.exec(m.content)?.[0]).find(Boolean)).not.toContain('difficulty');
  });
  it('正文难度模块紧跟现实行动可行性，位于写作偏好之前', async () => {
    const ids = (await story('standard')).modules.map((m) => m.id);
    expect(ids.indexOf('writing.difficulty_standard')).toBe(ids.indexOf('writing.action_feasibility') + 1);
  });
  it('动态世界：仅硬核的普通回合追加场外反制模块；标准和宽松不变', async () => {
    const a = stageContext();
    a.draft.turnKind = 'regular';
    a.draft.story!.turnKind = 'regular';
    const world = async (difficulty?: StoryDifficulty) => {
      return composePrompt({ stage: 'world', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings: withDifficulty(difficulty) });
    };
    const [base, standard, hardcore] = [await world(), await world('standard'), await world('hardcore')];
    expect(standard.messages).toEqual(base.messages);
    expect(hardcore.modules.map((m) => m.id).filter((id) => id.includes('difficulty'))).toEqual(['shared.10_world_difficulty_hardcore']);
    const body = text('shared/10_world_difficulty_hardcore.md');
    expect(hardcore.messages.filter((m) => m.content !== body)).toEqual(base.messages);
    const ids = hardcore.modules.map((m) => m.id);
    expect(ids.indexOf('shared.10_world_difficulty_hardcore')).toBeGreaterThan(ids.indexOf('stages.regular.world'));
  });
  it.each(['variables', 'memory'] as const)('%s 阶段不注入任何难度模块', (stage) => {
    for (const difficulty of STORY_DIFFICULTY_IDS) {
      const modules = selectPromptModules({ stage, mode: 'regular', settings: withDifficulty(difficulty), domains: [],
        ...(stage === 'memory' ? { memoryTask: 'memory.short_to_medium' } : {}) });
      expect(modules.some((m) => m.toggle?.startsWith('difficulty:'))).toBe(false);
    }
  });
  it('开局正文同样按难度启用', () => {
    const ids = selectPromptModules({ stage: 'story', mode: 'opening', settings: withDifficulty('hardcore'), domains: [] }).map((m) => m.id);
    expect(ids.filter((id) => id.includes('difficulty'))).toEqual(['writing.difficulty_hardcore']);
  });
});

describe('开局第五步选择难度', () => {
  const noop = () => {};
  function review() {
    const form = selectProfession(newCreation(), '教师');
    form.step = 5;
    form.person = { name: '林岚', age: '29', gender: '女性', appearance: '', personality: '' };
    return form;
  }
  const checked = (html: string) => html.match(/<input\b[^>]*name="creation-difficulty"[^>]*>/g)!
    .filter((tag) => tag.includes('checked=""')).map((tag) => /value="([a-z]+)"/.exec(tag)![1]);

  it('从未选过难度时默认选中「标准」，三档都可选', () => {
    const html = renderToStaticMarkup(<CreationWizard form={review()} onChange={noop} onCreate={noop} onExit={noop} busy={false} />);
    expect(html).toContain('剧情难度');
    expect(html.match(/name="creation-difficulty"/g)).toHaveLength(3);
    expect(checked(html)).toEqual(['standard']);
  });
  it('已在设置里选过时沿用设置里的档位', () => {
    for (const difficulty of STORY_DIFFICULTY_IDS) {
      const html = renderToStaticMarkup(<CreationWizard form={review()} difficulty={difficulty} onChange={noop} onCreate={noop} onExit={noop} busy={false} />);
      expect(checked(html)).toEqual([difficulty]);
    }
  });
  it('其他步骤不显示难度选项', () => {
    const form = review();
    form.step = 1;
    const html = renderToStaticMarkup(<CreationWizard form={form} onChange={noop} onCreate={noop} onExit={noop} busy={false} />);
    expect(html).not.toContain('creation-difficulty');
  });
});
